//! Wizard state and keyboard handling. Rendering lives in `ui.rs`.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use alfred_setup_core::config_generator::{generate_cloud_shell_script, SetupConfig};
use alfred_setup_core::validator::{validate_api_key, validate_email, validate_firebase_uid, validate_gcp_project_id};
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::deploy::{self, DeployEvent, DeployRun, STAGE_COUNT, SUCCESS_MARKER};
use crate::gcloud::{fetch_billing_accounts, BillingAccount};
use crate::i18n::{core_message, Lang};
use crate::input::TextInput;

pub const REGIONS: [&str; 6] = ["europe-west1", "eur3", "europe-west3", "us-central1", "nam5", "asia-northeast1"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Project,
    Account,
    Keys,
    Review,
    Deploying,
    Done,
    Failed,
}

impl Screen {
    pub fn step_index(self) -> usize {
        match self {
            Screen::Project => 0,
            Screen::Account => 1,
            Screen::Keys => 2,
            Screen::Review => 3,
            Screen::Deploying | Screen::Done | Screen::Failed => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    ProjectId,
    Billing,
    Region,
    Email,
    Uid,
    Evren,
    Groq,
    Gemini,
    Tavily,
}

pub enum Billing {
    Loading(Receiver<Result<Vec<BillingAccount>, String>>),
    Loaded(Vec<BillingAccount>),
    Failed(String),
}

pub struct DeployState {
    pub started: Instant,
    pub elapsed_secs: u64,
    pub lines: Vec<String>,
    pub stage: Option<usize>,
    pub succeeded: bool,
    pub exit_code: Option<i32>,
    pub scroll_up: usize,
    pub log_path: PathBuf,
    log: Option<BufWriter<File>>,
    run: Option<DeployRun>,
}

pub struct App {
    pub lang: Lang,
    pub screen: Screen,
    pub focus: usize,
    pub project_id: TextInput,
    pub email: TextInput,
    pub uid: TextInput,
    pub evren: TextInput,
    pub groq: TextInput,
    pub gemini: TextInput,
    pub tavily: TextInput,
    pub reveal_keys: bool,
    pub billing: Billing,
    pub billing_idx: usize,
    pub region_idx: usize,
    pub show_errors: bool,
    pub deploy: Option<DeployState>,
    pub quit_armed: bool,
    pub should_quit: bool,
    pub demo: bool,
    pub repo_root: PathBuf,
    /// Repository the Cloud Shell launcher cloned (`ALFRED_SOURCE_REPO`).
    pub source_repo: Option<String>,
}

pub const OFFICIAL_REPO: &str = "https://github.com/barissalihbabacan/alfred";

/// True when `url` is the official repository, ignoring case, `.git` and a trailing slash.
pub fn is_official_repo(url: &str) -> bool {
    let normalized = url.trim().trim_end_matches('/').trim_end_matches(".git").to_lowercase();
    normalized == OFFICIAL_REPO
}

impl App {
    pub fn new(lang: Lang, repo_root: PathBuf, demo: bool) -> Self {
        Self {
            lang,
            screen: Screen::Project,
            focus: 0,
            project_id: TextInput::default(),
            email: TextInput::default(),
            uid: TextInput::default(),
            evren: TextInput::masked(),
            groq: TextInput::masked(),
            gemini: TextInput::masked(),
            tavily: TextInput::masked(),
            reveal_keys: false,
            billing: Billing::Loading(fetch_billing_accounts(demo)),
            billing_idx: 0,
            region_idx: 0,
            show_errors: false,
            deploy: None,
            quit_armed: false,
            should_quit: false,
            demo,
            repo_root,
            source_repo: std::env::var("ALFRED_SOURCE_REPO").ok().filter(|s| !s.trim().is_empty()),
        }
    }

    /// The fields of the current screen, in display order. API keys follow the
    /// interface language: Turkish puts EVREN first, English puts Groq first.
    pub fn fields(&self) -> Vec<Field> {
        match self.screen {
            Screen::Project => vec![Field::ProjectId, Field::Billing, Field::Region],
            Screen::Account => vec![Field::Email, Field::Uid],
            Screen::Keys => match self.lang {
                Lang::Tr => vec![Field::Evren, Field::Groq, Field::Gemini, Field::Tavily],
                Lang::En => vec![Field::Groq, Field::Gemini, Field::Evren, Field::Tavily],
            },
            _ => Vec::new(),
        }
    }

    pub fn focused(&self) -> Option<Field> {
        self.fields().get(self.focus).copied()
    }

    pub fn input(&self, field: Field) -> Option<&TextInput> {
        match field {
            Field::ProjectId => Some(&self.project_id),
            Field::Email => Some(&self.email),
            Field::Uid => Some(&self.uid),
            Field::Evren => Some(&self.evren),
            Field::Groq => Some(&self.groq),
            Field::Gemini => Some(&self.gemini),
            Field::Tavily => Some(&self.tavily),
            Field::Billing | Field::Region => None,
        }
    }

    fn input_mut(&mut self, field: Field) -> Option<&mut TextInput> {
        match field {
            Field::ProjectId => Some(&mut self.project_id),
            Field::Email => Some(&mut self.email),
            Field::Uid => Some(&mut self.uid),
            Field::Evren => Some(&mut self.evren),
            Field::Groq => Some(&mut self.groq),
            Field::Gemini => Some(&mut self.gemini),
            Field::Tavily => Some(&mut self.tavily),
            Field::Billing | Field::Region => None,
        }
    }

    /// Validation error for a field, in the interface language.
    pub fn error(&self, field: Field) -> Option<String> {
        let message = match field {
            Field::ProjectId => validate_gcp_project_id(self.project_id.value()).err(),
            Field::Email => validate_email(self.email.value()).err(),
            Field::Uid => validate_firebase_uid(self.uid.value()).err(),
            Field::Evren => validate_api_key("evren", self.evren.value()).err(),
            Field::Groq => validate_api_key("groq", self.groq.value()).err(),
            Field::Gemini => validate_api_key("gemini", self.gemini.value()).err(),
            Field::Tavily => validate_api_key("tavily", self.tavily.value()).err(),
            Field::Billing => match &self.billing {
                Billing::Loaded(accounts) if !accounts.is_empty() => None,
                Billing::Loaded(_) => Some(self.lang.texts().billing_none.to_string()),
                Billing::Loading(_) => Some(self.lang.texts().billing_loading.to_string()),
                Billing::Failed(_) => Some(self.lang.texts().billing_failed.to_string()),
            },
            Field::Region => None,
        };
        message.map(|m| core_message(self.lang, &m))
    }

    /// Non-blocking advice, such as an unusual API key prefix.
    pub fn warning(&self, field: Field) -> Option<String> {
        let (provider, input) = match field {
            Field::Groq => ("groq", &self.groq),
            Field::Gemini => ("gemini", &self.gemini),
            Field::Tavily => ("tavily", &self.tavily),
            _ => return None,
        };
        let outcome = validate_api_key(provider, input.value()).ok()?;
        outcome.warnings.first().map(|w| core_message(self.lang, w))
    }

    pub fn has_chat_key(&self) -> bool {
        [&self.evren, &self.groq, &self.gemini].iter().any(|i| !i.value().trim().is_empty())
    }

    pub fn selected_billing(&self) -> Option<&BillingAccount> {
        match &self.billing {
            Billing::Loaded(accounts) => accounts.get(self.billing_idx),
            _ => None,
        }
    }

    pub fn config(&self) -> SetupConfig {
        let evren = self.evren.value().trim();
        SetupConfig {
            project_id: self.project_id.value().trim().to_string(),
            allowed_email: self.email.value().trim().to_lowercase(),
            allowed_uid: self.uid.value().trim().to_string(),
            groq_api_key: self.groq.value().trim().to_string(),
            gemini_api_key: self.gemini.value().trim().to_string(),
            tavily_api_key: self.tavily.value().trim().to_string(),
            evren_api_key: (!evren.is_empty()).then(|| evren.to_string()),
            ollama_url: None,
            firestore_region: Some(REGIONS[self.region_idx].to_string()),
            billing_account_id: self.selected_billing().map(|b| b.id.clone()),
        }
    }

    pub fn tick(&mut self) {
        if let Billing::Loading(rx) = &self.billing {
            if let Ok(result) = rx.try_recv() {
                self.billing = match result {
                    Ok(accounts) => Billing::Loaded(accounts),
                    Err(e) => Billing::Failed(e),
                };
                self.billing_idx = 0;
            }
        }
        self.drain_deploy_events();
    }

    fn drain_deploy_events(&mut self) {
        let Some(state) = self.deploy.as_mut() else { return };
        state.elapsed_secs = state.started.elapsed().as_secs();
        let Some(run) = state.run.as_ref() else { return };
        let mut finished = None;
        while let Ok(event) = run.events.try_recv() {
            match event {
                DeployEvent::Line(line) => {
                    if let Some(stage) = deploy::stage_of(&line) {
                        state.stage = Some(state.stage.map_or(stage, |s| s.max(stage)));
                    }
                    if line.contains(SUCCESS_MARKER) {
                        state.succeeded = true;
                    }
                    if let Some(log) = state.log.as_mut() {
                        let _ = writeln!(log, "{line}");
                    }
                    state.lines.push(line);
                }
                DeployEvent::Exited(code) => finished = Some(code),
            }
        }
        if let Some(code) = finished {
            if let Some(log) = state.log.as_mut() {
                let _ = log.flush();
            }
            state.run = None;
            state.exit_code = code;
            let ok = code == Some(0) && state.succeeded;
            if ok {
                state.stage = Some(STAGE_COUNT);
            }
            self.screen = if ok { Screen::Done } else { Screen::Failed };
        }
    }

    fn start_deploy(&mut self) {
        let config = self.config();
        let script = if self.demo {
            deploy::demo_script(&config.project_id)
        } else {
            generate_cloud_shell_script(&config)
        };
        let secrets = vec![
            ("GROQ_API_KEY", config.groq_api_key.clone()),
            ("GEMINI_API_KEY", config.gemini_api_key.clone()),
            ("TAVILY_API_KEY", config.tavily_api_key.clone()),
            ("EVREN_API_KEY", config.evren_api_key.clone().unwrap_or_default()),
        ];
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let log_path = home.join(format!("alfred-setup-{}-{stamp}.log", config.project_id));
        let log = File::create(&log_path).ok().map(BufWriter::new);
        let mut state = DeployState {
            started: Instant::now(),
            elapsed_secs: 0,
            lines: Vec::new(),
            stage: None,
            succeeded: false,
            exit_code: None,
            scroll_up: 0,
            log_path,
            log,
            run: None,
        };
        match deploy::start(&script, &self.repo_root, secrets) {
            Ok(run) => state.run = Some(run),
            Err(e) => {
                state.lines.push(format!("bash: {e}"));
                self.deploy = Some(state);
                self.screen = Screen::Failed;
                return;
            }
        }
        self.deploy = Some(state);
        self.screen = Screen::Deploying;
    }

    /// Puts the app on the deploy screen with the given log, for snapshots.
    #[cfg(test)]
    pub fn fake_deploy(&mut self, lines: &[&str], stage: Option<usize>, screen: Screen, exit_code: Option<i32>) {
        self.deploy = Some(DeployState {
            started: Instant::now(),
            elapsed_secs: 161,
            lines: lines.iter().map(|l| l.to_string()).collect(),
            stage,
            succeeded: screen == Screen::Done,
            exit_code,
            scroll_up: 0,
            log_path: PathBuf::from("/home/you/alfred-setup-alfred-x7k2qd.log"),
            log: None,
            run: None,
        });
        self.screen = screen;
    }

    fn step_is_valid(&self) -> bool {
        self.fields().iter().all(|f| self.error(*f).is_none())
    }

    fn go_next(&mut self) {
        if !self.step_is_valid() {
            self.show_errors = true;
            if let Some(i) = self.fields().iter().position(|f| self.error(*f).is_some()) {
                self.focus = i;
            }
            return;
        }
        self.show_errors = false;
        self.focus = 0;
        self.screen = match self.screen {
            Screen::Project => Screen::Account,
            Screen::Account => Screen::Keys,
            Screen::Keys => Screen::Review,
            other => other,
        };
    }

    fn go_back(&mut self) {
        self.show_errors = false;
        self.focus = 0;
        self.screen = match self.screen {
            Screen::Account => Screen::Project,
            Screen::Keys => Screen::Account,
            Screen::Review | Screen::Failed => Screen::Keys,
            other => other,
        };
        if self.screen == Screen::Keys {
            self.focus = self.fields().len().saturating_sub(1);
        }
    }

    fn generate_project_id(&mut self) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        let mut seed = u64::from(nanos) ^ (u64::from(std::process::id()) << 32);
        let suffix: String = (0..6)
            .map(|_| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789";
                alphabet[(seed >> 33) as usize % alphabet.len()] as char
            })
            .collect();
        self.project_id.set(&format!("alfred-{suffix}"));
    }

    pub fn on_paste(&mut self, text: &str) {
        if let Some(field) = self.focused() {
            if let Some(input) = self.input_mut(field) {
                input.paste(text.trim());
            }
        }
    }

    pub fn on_key(&mut self, key: KeyEvent) {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        if ctrl && key.code == KeyCode::Char('c') {
            self.on_interrupt();
            return;
        }
        self.quit_armed = false;
        if key.code == KeyCode::F(2) && matches!(self.screen, Screen::Project | Screen::Account | Screen::Keys | Screen::Review) {
            let field = self.focused();
            self.lang = self.lang.toggled();
            if let Some(f) = field {
                self.focus = self.fields().iter().position(|x| *x == f).unwrap_or(0);
            }
            return;
        }
        match self.screen {
            Screen::Project | Screen::Account | Screen::Keys => self.on_form_key(key, ctrl),
            Screen::Review => match key.code {
                KeyCode::Enter => self.start_deploy(),
                KeyCode::Esc => self.go_back(),
                _ => {}
            },
            Screen::Deploying => self.on_log_key(key),
            Screen::Done => {
                if matches!(key.code, KeyCode::Char('q') | KeyCode::Char('Q') | KeyCode::Esc | KeyCode::Enter) {
                    self.should_quit = true;
                }
            }
            Screen::Failed => match key.code {
                KeyCode::Enter => self.start_deploy(),
                KeyCode::Esc => self.screen = Screen::Review,
                KeyCode::Char('q') | KeyCode::Char('Q') => self.should_quit = true,
                _ => self.on_log_key(key),
            },
        }
    }

    fn on_interrupt(&mut self) {
        let running = self.deploy.as_ref().is_some_and(|d| d.run.is_some());
        if running && !self.quit_armed {
            self.quit_armed = true;
            return;
        }
        if let Some(run) = self.deploy.as_ref().and_then(|d| d.run.as_ref()) {
            run.stop();
        }
        self.should_quit = true;
    }

    fn on_log_key(&mut self, key: KeyEvent) {
        let Some(state) = self.deploy.as_mut() else { return };
        let max = state.lines.len();
        match key.code {
            KeyCode::PageUp | KeyCode::Up => state.scroll_up = (state.scroll_up + 5).min(max),
            KeyCode::PageDown | KeyCode::Down => state.scroll_up = state.scroll_up.saturating_sub(5),
            KeyCode::End => state.scroll_up = 0,
            _ => {}
        }
    }

    fn on_form_key(&mut self, key: KeyEvent, ctrl: bool) {
        let fields = self.fields();
        let Some(field) = fields.get(self.focus).copied() else { return };
        match key.code {
            KeyCode::Tab | KeyCode::Down if field != Field::Billing || key.code == KeyCode::Tab => {
                self.focus = (self.focus + 1) % fields.len();
            }
            KeyCode::BackTab | KeyCode::Up if field != Field::Billing || key.code == KeyCode::BackTab => {
                self.focus = (self.focus + fields.len() - 1) % fields.len();
            }
            KeyCode::Enter => {
                if self.focus + 1 < fields.len() && self.error(field).is_none() {
                    self.focus += 1;
                } else {
                    self.go_next();
                }
            }
            KeyCode::Esc => self.go_back(),
            KeyCode::Char('g') if ctrl && self.screen == Screen::Project => self.generate_project_id(),
            KeyCode::Char('r') if ctrl && self.screen == Screen::Project => {
                self.billing = Billing::Loading(fetch_billing_accounts(self.demo));
            }
            KeyCode::Char('r') if ctrl && self.screen == Screen::Keys => self.reveal_keys = !self.reveal_keys,
            _ => self.on_field_key(field, key, ctrl),
        }
    }

    fn on_field_key(&mut self, field: Field, key: KeyEvent, ctrl: bool) {
        match field {
            Field::Billing => {
                let count = match &self.billing {
                    Billing::Loaded(accounts) => accounts.len(),
                    _ => 0,
                };
                match key.code {
                    KeyCode::Up if count > 0 => self.billing_idx = (self.billing_idx + count - 1) % count,
                    KeyCode::Down if count > 0 => self.billing_idx = (self.billing_idx + 1) % count,
                    _ => {}
                }
            }
            Field::Region => match key.code {
                KeyCode::Left => self.region_idx = (self.region_idx + REGIONS.len() - 1) % REGIONS.len(),
                KeyCode::Right => self.region_idx = (self.region_idx + 1) % REGIONS.len(),
                _ => {}
            },
            _ => {
                let Some(input) = self.input_mut(field) else { return };
                match key.code {
                    KeyCode::Char(c) if !ctrl => input.insert(c),
                    KeyCode::Backspace => input.backspace(),
                    KeyCode::Delete => input.delete(),
                    KeyCode::Left => input.left(),
                    KeyCode::Right => input.right(),
                    KeyCode::Home => input.home(),
                    KeyCode::End => input.end(),
                    _ => {}
                }
            }
        }
    }
}
