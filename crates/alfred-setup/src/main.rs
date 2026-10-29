//! `alfred-setup`: the terminal setup wizard for Alfred.
//!
//! Usage: alfred-setup [--lang en|tr] [--repo PATH] [--demo]
//!   --demo  walks through every screen with fake billing accounts and a
//!           harmless script, without calling gcloud or deploying anything.

mod app;
mod deploy;
mod gcloud;
mod i18n;
mod input;
#[cfg(test)]
mod snapshots;
mod ui;

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use ratatui::crossterm::event::{self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyEventKind};
use ratatui::crossterm::execute;

use app::{Action, App, Screen};
use i18n::Lang;

struct Args {
    lang: Lang,
    repo: Option<PathBuf>,
    demo: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args { lang: Lang::from_env(), repo: None, demo: false };
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--demo" => args.demo = true,
            "--lang" => args.lang = Lang::from_code(&iter.next().ok_or("--lang needs en or tr")?),
            "--repo" => args.repo = Some(PathBuf::from(iter.next().ok_or("--repo needs a path")?)),
            "-h" | "--help" => return Err(String::new()),
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(args)
}

/// The Alfred checkout: the first ancestor holding firebase.json and functions/.
fn find_repo_root(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|dir| dir.join("firebase.json").is_file() && dir.join("functions").join("package.json").is_file())
        .map(Path::to_path_buf)
}

fn run(app: &mut App) -> io::Result<()> {
    let mut terminal = ratatui::init();
    execute!(io::stdout(), EnableBracketedPaste)?;
    let result = (|| -> io::Result<()> {
        while !app.should_quit {
            app.tick();
            terminal.draw(|frame| ui::draw(frame, app))?;
            if event::poll(Duration::from_millis(100))? {
                match event::read()? {
                    Event::Key(key) if key.kind == KeyEventKind::Press => app.on_key(key),
                    Event::Paste(text) => app.on_paste(&text),
                    _ => {}
                }
            }
            if app.take_action() == Some(Action::SwitchAccount) {
                // gcloud's sign-in is interactive: hand it the real terminal.
                let _ = execute!(io::stdout(), DisableBracketedPaste);
                ratatui::restore();
                if !app.demo {
                    let _ = std::process::Command::new("gcloud").args(["auth", "login", "--update-adc"]).status();
                }
                terminal = ratatui::init();
                execute!(io::stdout(), EnableBracketedPaste)?;
                app.after_account_switch();
            }
        }
        Ok(())
    })();
    let _ = execute!(io::stdout(), DisableBracketedPaste);
    ratatui::restore();
    result
}

fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            if !message.is_empty() {
                eprintln!("alfred-setup: {message}");
            }
            eprintln!("Usage: alfred-setup [--lang en|tr] [--repo PATH] [--demo]");
            std::process::exit(2);
        }
    };

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let repo_root = match args.repo.or_else(|| find_repo_root(&cwd)) {
        Some(root) => root,
        None if args.demo => cwd,
        None => {
            eprintln!("alfred-setup: run this inside the Alfred repository (no firebase.json found above {}).", cwd.display());
            std::process::exit(2);
        }
    };

    let mut app = App::new(args.lang, repo_root, args.demo);
    if let Err(e) = run(&mut app) {
        eprintln!("alfred-setup: {e}");
        std::process::exit(1);
    }

    if app.screen == Screen::Done {
        println!("Alfred: https://{}.web.app", app.config().project_id);
    } else if let Some(state) = app.deploy.as_ref() {
        println!("Log: {}", state.log_path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_repository_root_from_a_subdirectory() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = find_repo_root(here).expect("crate lives inside the Alfred repo");
        assert!(root.join("firebase.json").is_file());
    }
}
