//! Renders every screen into an in-memory terminal. The tests assert on the
//! visible text; with `ALFRED_SETUP_SNAPSHOTS=<dir>` they also write each screen
//! as a coloured HTML page for visual review.

use std::path::PathBuf;

use ratatui::backend::TestBackend;
use ratatui::buffer::Buffer;
use ratatui::style::{Color, Modifier};
use ratatui::Terminal;

use crate::app::{App, Billing, Screen};
use crate::gcloud::BillingAccount;
use crate::i18n::Lang;
use crate::ui;

const WIDTH: u16 = 100;
const HEIGHT: u16 = 30;

fn app(lang: Lang) -> App {
    let mut app = App::new(lang, PathBuf::from("."), true);
    app.billing = Billing::Loaded(vec![
        BillingAccount { id: "01A2B3-C4D5E6-F7A8B9".into(), name: "My Billing Account".into() },
        BillingAccount { id: "0F1E2D-3C4B5A-697887".into(), name: "Side projects".into() },
    ]);
    app.project_id.set("alfred-x7k2qd");
    app.name.set("Alex Doe");
    app.email.set("you@gmail.com");
    app
}

fn render(app: &App) -> Buffer {
    let mut terminal = Terminal::new(TestBackend::new(WIDTH, HEIGHT)).expect("test backend");
    terminal.draw(|frame| ui::draw(frame, app)).expect("draw");
    terminal.backend().buffer().clone()
}

fn text(buffer: &Buffer) -> String {
    (0..buffer.area.height)
        .map(|y| (0..buffer.area.width).map(|x| buffer[(x, y)].symbol()).collect::<String>())
        .collect::<Vec<_>>()
        .join("\n")
}

fn css(color: Color, fallback: &str) -> String {
    match color {
        Color::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
        _ => fallback.to_string(),
    }
}

fn html(buffer: &Buffer) -> String {
    let mut rows = String::new();
    for y in 0..buffer.area.height {
        for x in 0..buffer.area.width {
            let cell = &buffer[(x, y)];
            let symbol = match cell.symbol() {
                "<" => "&lt;".to_string(),
                ">" => "&gt;".to_string(),
                "&" => "&amp;".to_string(),
                s => s.to_string(),
            };
            let weight = if cell.modifier.contains(Modifier::BOLD) { "font-weight:700;" } else { "" };
            rows.push_str(&format!(
                "<span style=\"color:{};background:{};{weight}\">{symbol}</span>",
                css(cell.fg, "#f4efe3"),
                css(cell.bg, "transparent")
            ));
        }
        rows.push('\n');
    }
    format!(
        "<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0;background:#0b1220\">\
         <pre style=\"margin:0;padding:18px 22px;font:15px/1.35 'SF Mono',Menlo,monospace;color:#f4efe3\">{rows}</pre>"
    )
}

fn snapshot(name: &str, buffer: &Buffer) {
    if let Some(dir) = std::env::var_os("ALFRED_SETUP_SNAPSHOTS") {
        let path = PathBuf::from(dir).join(format!("{name}.html"));
        std::fs::write(path, html(buffer)).expect("write snapshot");
    }
}

#[test]
fn project_screen_lists_billing_accounts_and_region() {
    let buffer = render(&app(Lang::En));
    let screen = text(&buffer);
    assert!(screen.contains("Google Cloud project"));
    assert!(screen.contains("My Billing Account"));
    assert!(screen.contains("europe-west1"));
    snapshot("1-project-en", &buffer);
}

#[test]
fn account_screen_in_turkish() {
    let mut app = app(Lang::Tr);
    app.screen = Screen::Account;
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("Hesabın"));
    assert!(screen.contains("Adın"));
    assert!(screen.contains("Alex Doe"));
    assert!(screen.contains("Google e-postası"));
    snapshot("2-account-tr", &buffer);
}

#[test]
fn key_order_follows_the_language() {
    let mut tr = app(Lang::Tr);
    tr.screen = Screen::Keys;
    let tr_text = text(&render(&tr));
    assert!(tr_text.find("EVREN (TÜBİTAK").unwrap() < tr_text.find("Google Gemini").unwrap());

    let mut en = app(Lang::En);
    en.screen = Screen::Keys;
    en.groq.set("gsk_live_example_key");
    en.gemini.set("not-a-gemini-prefix");
    en.focus = 1;
    let buffer = render(&en);
    let en_text = text(&buffer);
    assert!(en_text.find("Google Gemini").unwrap() < en_text.find("EVREN (TÜBİTAK").unwrap());
    assert!(en_text.contains("••••"));
    assert!(!en_text.contains("gsk_live_example_key"), "keys must be masked");
    assert!(en_text.contains("usually begin with 'AIza'"));
    snapshot("3-keys-en", &buffer);
}

#[test]
fn invalid_project_id_shows_the_error_and_footer() {
    let mut app = app(Lang::Tr);
    app.project_id.set("Alfred_Prod");
    app.show_errors = true;
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("küçük bir harfle başlamalı"));
    assert!(screen.contains("işaretli alanı düzelt"));
    snapshot("1b-project-error-tr", &buffer);
}

#[test]
fn review_warns_without_a_chat_key() {
    let mut app = app(Lang::En);
    app.screen = Screen::Review;
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("No chat key"));
    assert!(screen.contains("My Billing Account (01A2B3-C4D5E6-F7A8B9)"));
    snapshot("4-review-en", &buffer);

    app.groq.set("gsk_live_example_key");
    assert!(!text(&render(&app)).contains("No chat key"));
}

#[test]
fn deploy_screen_shows_stages_and_log() {
    let mut app = app(Lang::En);
    app.fake_deploy(
        &[
            "[Alfred Setup] Enabling required Google Cloud and Firebase APIs...",
            "Operation \"operations/acf.p2-123\" finished successfully.",
            "[Alfred Setup] Provisioning Secret Manager vault...",
            "  Creating secret container: GROQ_API_KEY...",
            "[Alfred Setup] Building Next.js web application for production...",
            "   ▲ Next.js 16.3.6 (Turbopack)",
            "   ✓ Compiled successfully in 9.8s",
        ],
        Some(7),
        Screen::Deploying,
        None,
    );
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("Deploying alfred-x7k2qd"));
    assert!(screen.contains("02:41"));
    assert!(screen.contains("7/9"));
    assert!(screen.contains("Compiled successfully"));
    snapshot("5-deploying-en", &buffer);
}

#[test]
fn failed_deploy_points_to_the_log() {
    let mut app = app(Lang::Tr);
    app.fake_deploy(&["ERROR: (gcloud.billing.projects.link) PERMISSION_DENIED"], Some(1), Screen::Failed, Some(1));
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("çıkış kodu 1"));
    assert!(screen.contains("alfred-setup-alfred-x7k2qd.log"));
    snapshot("6-failed-tr", &buffer);
}

#[test]
fn done_screen_lists_the_console_steps() {
    let mut app = app(Lang::En);
    app.fake_deploy(&[], Some(9), Screen::Done, Some(0));
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("https://alfred-x7k2qd.web.app"));
    assert!(screen.contains("authentication/providers"));
    assert!(screen.contains("you@gmail.com"));
    snapshot("7-done-en", &buffer);
}

#[test]
fn every_screen_fits_80_by_24() {
    for screen in [Screen::Project, Screen::Account, Screen::Keys, Screen::Review] {
        let mut app = app(Lang::Tr);
        app.screen = screen;
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
        terminal.draw(|frame| ui::draw(frame, &app)).unwrap();
    }
}

#[test]
fn review_warns_about_an_unofficial_source_repository() {
    let mut app = app(Lang::En);
    app.screen = Screen::Review;
    app.source_repo = Some("https://github.com/barissalihbabacan/Alfred.git".into());
    assert!(!text(&render(&app)).contains("not the official"));
    app.source_repo = Some("https://github.com/someone-else/alfred-lookalike".into());
    let buffer = render(&app);
    let screen = text(&buffer);
    assert!(screen.contains("someone-else/alfred-lookalike"));
    assert!(screen.contains("not the official Alfred repository"));
    snapshot("4b-review-unofficial-en", &buffer);
}
