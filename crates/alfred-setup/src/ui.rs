//! Draws the wizard. Every screen fits in an 80×24 terminal.

use ratatui::layout::{Constraint, Layout, Margin, Position, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Gauge, Paragraph, Wrap};
use ratatui::Frame;

use crate::app::{App, Billing, Field, Screen, REGIONS};
use crate::deploy::STAGE_COUNT;

const GOLD: Color = Color::Rgb(201, 164, 92);
const GOLD_LIGHT: Color = Color::Rgb(229, 199, 125);
const TEXT: Color = Color::Rgb(244, 239, 227);
const MUTED: Color = Color::Rgb(138, 148, 166);
const FAINT: Color = Color::Rgb(90, 99, 117);
const GREEN: Color = Color::Rgb(16, 185, 129);
const RED: Color = Color::Rgb(239, 68, 68);
const YELLOW: Color = Color::Rgb(234, 179, 8);

pub fn draw(frame: &mut Frame, app: &App) {
    let t = app.lang.texts();
    let outer = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(GOLD))
        .title(Line::from(format!(" {} ", t.title)).bold().fg(GOLD_LIGHT))
        .title(Line::from(format!(" {} ", t.lang_badge)).fg(MUTED).right_aligned());
    let area = frame.area();
    frame.render_widget(outer, area);
    let inner = area.inner(Margin::new(2, 1));

    let [stepper, _, body, footer] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(5),
        Constraint::Length(1),
    ])
    .areas(inner);

    frame.render_widget(Paragraph::new(stepper_line(app)), stepper);
    match app.screen {
        Screen::Project | Screen::Account | Screen::Keys => draw_form(frame, app, body),
        Screen::Review => draw_review(frame, app, body),
        Screen::Deploying | Screen::Failed => draw_deploy(frame, app, body),
        Screen::Done => draw_done(frame, app, body),
    }
    frame.render_widget(Paragraph::new(footer_line(app)), footer);
}

fn stepper_line(app: &App) -> Line<'static> {
    let t = app.lang.texts();
    let current = app.screen.step_index();
    let done_all = app.screen == Screen::Done;
    let mut spans = Vec::new();
    for (i, name) in t.steps.iter().enumerate() {
        if i > 0 {
            spans.push(Span::styled(" ── ", Style::new().fg(FAINT)));
        }
        let (mark, style) = if i < current || done_all {
            ("✓", Style::new().fg(GREEN))
        } else if i == current {
            ("●", Style::new().fg(GOLD).add_modifier(Modifier::BOLD))
        } else {
            ("○", Style::new().fg(MUTED))
        };
        spans.push(Span::styled(format!("{mark} {name}"), style));
    }
    Line::from(spans)
}

fn footer_line(app: &App) -> Line<'static> {
    let t = app.lang.texts();
    if app.quit_armed {
        return Line::from(t.quit_confirm).fg(YELLOW);
    }
    let form = matches!(app.screen, Screen::Project | Screen::Account | Screen::Keys);
    if form && app.show_errors {
        return Line::from(t.fix_field).fg(RED);
    }
    let hint = match app.screen {
        Screen::Project | Screen::Account | Screen::Keys => t.footer_form,
        Screen::Review => t.footer_review,
        Screen::Deploying => t.footer_deploy,
        Screen::Done => t.footer_done,
        Screen::Failed => t.footer_failed,
    };
    Line::from(hint).fg(MUTED)
}

fn label(field: Field, app: &App) -> &'static str {
    let t = app.lang.texts();
    match field {
        Field::ProjectId => t.project_id,
        Field::Billing => t.billing,
        Field::Region => t.region,
        Field::Name => t.name,
        Field::Email => t.email,
        Field::Uid => t.uid,
        Field::Evren => t.key_evren,
        Field::Groq => t.key_groq,
        Field::Gemini => t.key_gemini,
        Field::Tavily => t.key_tavily,
    }
}

fn hint(field: Field, app: &App) -> &'static str {
    let t = app.lang.texts();
    match field {
        Field::ProjectId => t.project_id_hint,
        Field::Billing => t.billing_hint,
        Field::Region => t.region_hint,
        Field::Name => t.name_hint,
        Field::Email => "",
        Field::Uid => t.uid_hint,
        Field::Evren => t.key_evren_hint,
        Field::Groq => t.key_groq_hint,
        Field::Gemini => t.key_gemini_hint,
        Field::Tavily => t.key_tavily_hint,
    }
}

fn placeholder(field: Field, app: &App) -> &'static str {
    let t = app.lang.texts();
    match field {
        Field::ProjectId => t.project_id_placeholder,
        Field::Name => t.name_placeholder,
        Field::Email => t.email_placeholder,
        Field::Evren | Field::Groq | Field::Gemini | Field::Tavily => t.key_placeholder,
        _ => "",
    }
}

fn draw_form(frame: &mut Frame, app: &App, area: Rect) {
    let t = app.lang.texts();
    let (heading, intro) = match app.screen {
        Screen::Project => (t.project_heading, t.project_intro),
        Screen::Account => (t.account_heading, t.account_intro),
        _ => (t.keys_heading, t.keys_intro),
    };
    let mut lines: Vec<Line> = vec![Line::from(heading).bold().fg(TEXT), Line::from(intro).fg(MUTED)];
    if app.screen == Screen::Keys {
        lines.push(Line::from(t.chain_note).fg(GOLD));
    }
    lines.push(Line::default());

    let mut cursor: Option<(usize, usize)> = None;
    for (i, field) in app.fields().into_iter().enumerate() {
        let focused = i == app.focus;
        let marker = if focused { "▸ " } else { "  " };
        let label_style = if focused { Style::new().fg(GOLD).bold() } else { Style::new().fg(TEXT) };
        lines.push(Line::from(vec![Span::styled(marker, Style::new().fg(GOLD)), Span::styled(label(field, app), label_style)]));

        match field {
            Field::Billing => lines.extend(billing_lines(app, focused)),
            Field::Region => lines.push(region_line(app, focused)),
            _ => {
                let input = app.input(field).expect("text field");
                let shown = input.display(app.reveal_keys);
                let value_line = if shown.is_empty() {
                    Line::from(vec![Span::raw("  "), Span::styled(placeholder(field, app), Style::new().fg(FAINT))])
                } else {
                    Line::from(vec![Span::raw("  "), Span::styled(shown, Style::new().fg(TEXT))])
                };
                if focused {
                    cursor = Some((lines.len(), 2 + input.cursor()));
                }
                lines.push(value_line);
            }
        }

        let has_value = app.input(field).is_some_and(|i| !i.value().is_empty());
        let show_error = app.show_errors || has_value || field == Field::Billing;
        if let Some(message) = app.error(field).filter(|_| show_error) {
            lines.push(Line::from(format!("  {message}")).fg(RED));
        } else if let Some(warning) = app.warning(field) {
            lines.push(Line::from(format!("  {warning}")).fg(YELLOW));
        } else if focused && !hint(field, app).is_empty() {
            lines.push(Line::from(format!("  {}", hint(field, app))).fg(MUTED));
        }
        lines.push(Line::default());
    }

    let height = area.height as usize;
    let scroll = cursor.map_or(0, |(row, _)| (row + 3).saturating_sub(height));
    let paragraph = Paragraph::new(lines).wrap(Wrap { trim: false }).scroll((scroll as u16, 0));
    frame.render_widget(paragraph, area);

    if let Some((row, col)) = cursor {
        let y = area.y as usize + row - scroll;
        if y < (area.y + area.height) as usize {
            frame.set_cursor_position(Position::new(area.x + col as u16, y as u16));
        }
    }
}

fn billing_lines(app: &App, focused: bool) -> Vec<Line<'static>> {
    match &app.billing {
        Billing::Loaded(accounts) if !accounts.is_empty() => accounts
            .iter()
            .enumerate()
            .map(|(i, account)| {
                let selected = i == app.billing_idx;
                let mark = if selected { "◉" } else { "○" };
                let style = match (selected, focused) {
                    (true, true) => Style::new().fg(GOLD).bold(),
                    (true, false) => Style::new().fg(TEXT),
                    _ => Style::new().fg(MUTED),
                };
                Line::from(vec![
                    Span::raw("  "),
                    Span::styled(format!("{mark} {}", account.name), style),
                    Span::styled(format!("  {}", account.id), Style::new().fg(FAINT)),
                ])
            })
            .collect(),
        Billing::Failed(reason) => vec![Line::from(format!("  {reason}")).fg(FAINT)],
        _ => Vec::new(),
    }
}

fn region_line(app: &App, focused: bool) -> Line<'static> {
    let style = if focused { Style::new().fg(GOLD).bold() } else { Style::new().fg(TEXT) };
    Line::from(vec![
        Span::raw("  "),
        Span::styled("◂ ", Style::new().fg(MUTED)),
        Span::styled(REGIONS[app.region_idx], style),
        Span::styled(" ▸", Style::new().fg(MUTED)),
    ])
}

fn draw_review(frame: &mut Frame, app: &App, area: Rect) {
    let t = app.lang.texts();
    let config = app.config();
    let key = |value: &str| if value.trim().is_empty() { t.review_unset } else { t.review_set };
    let billing = app.selected_billing().map(|b| format!("{} ({})", b.name, b.id)).unwrap_or_default();
    let uid = if config.allowed_uid.is_empty() { t.review_uid_empty.to_string() } else { config.allowed_uid.clone() };
    let rows = [
        (t.project_id, config.project_id.clone()),
        (t.billing, billing),
        (t.region, REGIONS[app.region_idx].to_string()),
        (t.name, config.owner_name.clone()),
        (t.email, config.allowed_email.clone()),
        (t.uid, uid),
        (t.key_evren, key(app.evren.value()).to_string()),
        (t.key_groq, key(app.groq.value()).to_string()),
        (t.key_gemini, key(app.gemini.value()).to_string()),
        (t.key_tavily, key(app.tavily.value()).to_string()),
    ];
    let mut lines = vec![Line::from(t.review_heading).bold().fg(TEXT), Line::default()];
    for (name, value) in rows {
        lines.push(Line::from(vec![
            Span::styled(format!("  {name:<30}"), Style::new().fg(MUTED)),
            Span::styled(value, Style::new().fg(TEXT)),
        ]));
    }
    if let Some(source) = app.source_repo.as_deref() {
        lines.push(Line::from(vec![
            Span::styled(format!("  {:<30}", t.review_source), Style::new().fg(MUTED)),
            Span::styled(source.to_string(), Style::new().fg(TEXT)),
        ]));
    }
    lines.push(Line::default());
    if app.source_repo.as_deref().is_some_and(|s| !crate::app::is_official_repo(s)) {
        lines.push(Line::from(format!("! {}", t.review_unofficial)).fg(RED).bold());
        lines.push(Line::default());
    }
    if !app.has_chat_key() {
        lines.push(Line::from(format!("! {}", t.review_no_chat_key)).fg(YELLOW));
        lines.push(Line::default());
    }
    lines.push(Line::from(t.review_cta).fg(GOLD).bold());
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), area);
}

fn draw_deploy(frame: &mut Frame, app: &App, area: Rect) {
    let t = app.lang.texts();
    let Some(state) = app.deploy.as_ref() else { return };
    let [head, stages, gauge, log] = Layout::vertical([
        Constraint::Length(2),
        Constraint::Length(3),
        Constraint::Length(2),
        Constraint::Min(3),
    ])
    .areas(area);

    let elapsed = format!("{:02}:{:02}", state.elapsed_secs / 60, state.elapsed_secs % 60);
    let title = format!("{} {}", t.deploy_heading, app.config().project_id);
    frame.render_widget(
        Paragraph::new(Line::from(vec![Span::styled(title, Style::new().fg(TEXT).bold()), Span::styled(format!("   {elapsed}"), Style::new().fg(GOLD))])),
        head,
    );

    let failed = app.screen == Screen::Failed;
    let current = state.stage.unwrap_or(0);
    let cells: Vec<Span> = t
        .deploy_stages
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let (mark, color) = if state.stage.is_some_and(|s| i < s) {
                ("✓", GREEN)
            } else if i == current && failed {
                ("✗", RED)
            } else if i == current && state.stage.is_some() {
                ("◐", GOLD)
            } else {
                ("○", MUTED)
            };
            Span::styled(format!("{mark} {name:<13}"), Style::new().fg(color))
        })
        .collect();
    let stage_lines: Vec<Line> = cells.chunks(3).map(|row| Line::from(row.to_vec())).collect();
    frame.render_widget(Paragraph::new(stage_lines), stages);

    let done = state.stage.map_or(0, |s| s.min(STAGE_COUNT));
    let ratio = done as f64 / STAGE_COUNT as f64;
    let gauge_color = if failed { RED } else { GOLD };
    frame.render_widget(
        Gauge::default().ratio(ratio).label(format!("{done}/{STAGE_COUNT}")).gauge_style(Style::new().fg(gauge_color).bg(Color::Rgb(38, 52, 77))),
        Rect { height: 1, ..gauge },
    );

    let mut log_lines: Vec<Line> = Vec::new();
    if failed {
        let code = state.exit_code.map_or("?".to_string(), |c| c.to_string());
        let message = t.deploy_failed.replace("{code}", &code).replace("{log}", &state.log_path.display().to_string());
        log_lines.push(Line::from(message).fg(RED));
    }
    let visible = (log.height.saturating_sub(2) as usize).saturating_sub(log_lines.len());
    let end = state.lines.len().saturating_sub(state.scroll_up);
    let start = end.saturating_sub(visible);
    log_lines.extend(state.lines[start..end].iter().map(|l| Line::from(l.clone()).fg(MUTED)));
    let block = Block::bordered().border_type(BorderType::Rounded).border_style(Style::new().fg(FAINT)).title(format!(" {} ", t.deploy_log));
    frame.render_widget(Paragraph::new(log_lines).block(block), log);
}

fn draw_done(frame: &mut Frame, app: &App, area: Rect) {
    let t = app.lang.texts();
    let config = app.config();
    let url = format!("https://{}.web.app", config.project_id);
    let providers = format!("https://console.firebase.google.com/project/{}/authentication/providers", config.project_id);
    let lines = vec![
        Line::from(format!("✓ {}", t.done_heading)).fg(GREEN).bold(),
        Line::default(),
        Line::from(vec![Span::styled(format!("{}  ", t.done_open), Style::new().fg(MUTED)), Span::styled(url, Style::new().fg(GOLD_LIGHT).bold())]),
        Line::default(),
        Line::from(t.done_next).fg(TEXT).bold(),
        Line::from(format!("  1. {}", t.done_step_google)).fg(TEXT),
        Line::from(format!("     {providers}")).fg(GOLD),
        Line::from(format!("  2. {} {}", t.done_step_signin, config.allowed_email)).fg(TEXT),
        Line::from(format!("  3. {}", t.done_step_appcheck)).fg(MUTED),
    ];
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), area);
}
