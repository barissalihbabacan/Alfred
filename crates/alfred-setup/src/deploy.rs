//! Runs the provisioning script in a private temp directory and streams its
//! output. API keys travel only as environment variables of the child process.

use std::fs::{self, DirBuilder};
use std::io::{BufRead, BufReader, Read};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub enum DeployEvent {
    Line(String),
    Exited(Option<i32>),
}

/// The secrets the script reads from its environment, by variable name.
pub type SecretEnv = Vec<(&'static str, String)>;

pub struct DeployRun {
    pub events: Receiver<DeployEvent>,
    child: Arc<Mutex<Child>>,
}

impl DeployRun {
    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

/// Markers echoed by `generate_cloud_shell_script`, mapped to stage indexes.
const STAGE_MARKERS: &[(&str, usize)] = &[
    ("[Alfred Setup] Project", 0),
    ("Configuring Google Cloud project", 0),
    ("billing account", 1),
    ("Billing account", 1),
    ("Enabling required Google Cloud", 2),
    ("Ensuring Firebase is enabled", 3),
    ("Configuring Firebase Web App", 3),
    ("Ensuring Firestore database", 4),
    ("Provisioning Secret Manager vault", 5),
    ("Writing local environment config", 6),
    ("Writing Cloud Functions environment", 6),
    ("Writing web app production", 6),
    ("Installing dependencies", 7),
    ("Initializing user persona", 7),
    ("Building Next.js", 7),
    ("Deploying to Firebase", 8),
];

pub const STAGE_COUNT: usize = 9;
pub const SUCCESS_MARKER: &str = "successfully provisioned and deployed";

pub fn stage_of(line: &str) -> Option<usize> {
    STAGE_MARKERS.iter().find(|(marker, _)| line.contains(marker)).map(|(_, stage)| *stage)
}

/// Pictographic emoji and their joiners/variation selectors are two cells wide
/// in most terminals and shift the log frame, so they are dropped.
fn is_wide_pictograph(c: char) -> bool {
    matches!(c as u32, 0x1F000..=0x1FAFF | 0x2728 | 0x274C | 0xFE0F | 0x200D)
}

/// Removes ANSI escape sequences and emoji, and keeps only the last
/// carriage-return frame.
pub fn clean_line(raw: &str) -> String {
    let last_frame = raw.rsplit('\r').next().unwrap_or(raw);
    let mut out = String::with_capacity(last_frame.len());
    let mut chars = last_frame.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if (!c.is_control() || c == '\t') && !is_wide_pictograph(c) {
            out.push(c);
        }
    }
    let trimmed = out.trim_start();
    if trimmed.starts_with("[Alfred Setup]") {
        trimmed.to_string()
    } else {
        out
    }
}

fn private_dir() -> std::io::Result<PathBuf> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("alfred-setup-{}-{nanos}", std::process::id()));
    DirBuilder::new().mode(0o700).create(&dir)?;
    Ok(dir)
}

fn write_private_file(path: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?;
    file.write_all(content.as_bytes())
}

fn forward_lines<R: Read + Send + 'static>(reader: R, tx: Sender<DeployEvent>) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if tx.send(DeployEvent::Line(clean_line(&line))).is_err() {
                break;
            }
        }
    });
}

/// Writes `script` to a private temp dir and runs it with bash in `repo_root`.
/// Secrets with an empty value are removed from the child's environment so the
/// script keeps any secret that already exists in Secret Manager.
pub fn start(script: &str, repo_root: &Path, secrets: SecretEnv) -> std::io::Result<DeployRun> {
    let dir = private_dir()?;
    let script_path = dir.join("provision.sh");
    write_private_file(&script_path, script)?;

    let mut command = Command::new("bash");
    command
        .arg(&script_path)
        .current_dir(repo_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("FORCE_COLOR", "0")
        .env("NO_COLOR", "1");
    for (name, value) in secrets {
        if value.is_empty() {
            command.env_remove(name);
        } else {
            command.env(name, value);
        }
    }

    let mut child = command.spawn()?;
    let (tx, rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        forward_lines(stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        forward_lines(stderr, tx.clone());
    }

    let child = Arc::new(Mutex::new(child));
    let waiter = Arc::clone(&child);
    thread::spawn(move || {
        let code = loop {
            let status = waiter.lock().ok().and_then(|mut c| c.try_wait().ok().flatten());
            if let Some(status) = status {
                break status.code();
            }
            thread::sleep(Duration::from_millis(150));
        };
        // Give the reader threads a moment to flush the last lines.
        thread::sleep(Duration::from_millis(200));
        let _ = fs::remove_dir_all(&dir);
        let _ = tx.send(DeployEvent::Exited(code));
    });

    Ok(DeployRun { events: rx, child })
}

/// A harmless script that prints the same markers, for `--demo`.
pub fn demo_script(project_id: &str) -> String {
    let steps = [
        "🚀 [Alfred Setup] Project does not exist yet. Creating it in Google Cloud...",
        "💳 [Alfred Setup] Linking selected billing account...",
        "🔑 [Alfred Setup] Enabling required Google Cloud and Firebase APIs...",
        "🔥 [Alfred Setup] Ensuring Firebase is enabled on Google Cloud project...",
        "🗄️ [Alfred Setup] Ensuring Firestore database exists in Native mode...",
        "🛡️ [Alfred Setup] Provisioning Secret Manager vault...",
        "📝 [Alfred Setup] Writing Cloud Functions environment config...",
        "🏗️ [Alfred Setup] Building Next.js web application for production...",
        "🚀 [Alfred Setup] Deploying to Firebase (Hosting, Functions & Security Rules)...",
    ];
    let mut script = String::from("set -e\n");
    for step in steps {
        script.push_str(&format!("echo '{step}'\nsleep 0.6\necho '  … working'\nsleep 0.4\n"));
    }
    script.push_str(&format!(
        "echo '✨ Alfred has been {SUCCESS_MARKER}!'\necho '🌐 Open your application: https://{project_id}.web.app'\n"
    ));
    script
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_and_carriage_returns() {
        assert_eq!(clean_line("\u{1b}[32m✔\u{1b}[0m done"), "✔ done");
        assert_eq!(clean_line("10%\r50%\r100% ready"), "100% ready");
    }

    #[test]
    fn drops_wide_emoji_but_keeps_narrow_marks() {
        assert_eq!(clean_line("🛡️ [Alfred Setup] Provisioning Secret Manager vault..."), "[Alfred Setup] Provisioning Secret Manager vault...");
        assert_eq!(clean_line("   ✓ Compiled successfully"), "   ✓ Compiled successfully");
        assert_eq!(clean_line("   ▲ Next.js 16"), "   ▲ Next.js 16");
    }

    #[test]
    fn maps_generator_markers_to_stages() {
        assert_eq!(stage_of("🔑 [Alfred Setup] Enabling required Google Cloud and Firebase APIs..."), Some(2));
        assert_eq!(stage_of("🚀 [Alfred Setup] Deploying to Firebase (Hosting...)"), Some(8));
        assert_eq!(stage_of("i  functions: updating"), None);
    }

    #[test]
    fn every_stage_has_a_marker_in_the_real_script() {
        let config = alfred_setup_core::config_generator::SetupConfig {
            project_id: "demo-alfred".into(),
            allowed_email: "owner@gmail.com".into(),
            billing_account_id: Some("01A2B3-C4D5E6-F7A8B9".into()),
            ..Default::default()
        };
        let script = alfred_setup_core::config_generator::generate_cloud_shell_script(&config);
        for stage in 0..STAGE_COUNT {
            assert!(
                script.lines().any(|line| line.contains("echo") && stage_of(line) == Some(stage)),
                "no echo marker for stage {stage}"
            );
        }
        assert!(script.contains(SUCCESS_MARKER));
    }

    #[test]
    fn runs_a_script_with_secrets_only_in_its_environment() {
        let dir = std::env::temp_dir();
        let run = start(
            "echo \"key=${GROQ_API_KEY:-none}\"\necho \"gemini=${GEMINI_API_KEY:-none}\"\nexit 3\n",
            &dir,
            vec![("GROQ_API_KEY", "gsk_test".into()), ("GEMINI_API_KEY", String::new())],
        )
        .unwrap();
        let mut lines = Vec::new();
        let code = loop {
            match run.events.recv_timeout(Duration::from_secs(10)).unwrap() {
                DeployEvent::Line(line) => lines.push(line),
                DeployEvent::Exited(code) => break code,
            }
        };
        assert_eq!(code, Some(3));
        assert!(lines.contains(&"key=gsk_test".to_string()));
        assert!(lines.contains(&"gemini=none".to_string()));
    }
}
