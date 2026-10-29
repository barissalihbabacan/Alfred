//! Read-only questions to the `gcloud` CLI, answered on a background thread.

use std::process::Command;
use std::sync::mpsc::{self, Receiver};
use std::thread;

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingAccount {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct RawBillingAccount {
    name: String,
    #[serde(rename = "displayName", default)]
    display_name: String,
}

/// Parses `gcloud billing accounts list --format=json`.
pub fn parse_billing_accounts(json: &str) -> Result<Vec<BillingAccount>, String> {
    let raw: Vec<RawBillingAccount> = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|account| {
            let id = account.name.trim_start_matches("billingAccounts/").to_string();
            let name = if account.display_name.is_empty() { id.clone() } else { account.display_name };
            BillingAccount { id, name }
        })
        .collect())
}

fn list_open_billing_accounts() -> Result<Vec<BillingAccount>, String> {
    let output = Command::new("gcloud")
        .args(["billing", "accounts", "list", "--filter=open=true", "--format=json"])
        .output()
        .map_err(|e| format!("gcloud: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.lines().last().unwrap_or("gcloud failed").trim().to_string());
    }
    parse_billing_accounts(&String::from_utf8_lossy(&output.stdout))
}

fn demo_billing_accounts() -> Result<Vec<BillingAccount>, String> {
    Ok(vec![
        BillingAccount { id: "01A2B3-C4D5E6-F7A8B9".into(), name: "My Billing Account".into() },
        BillingAccount { id: "0F1E2D-3C4B5A-697887".into(), name: "Side projects".into() },
    ])
}

/// Starts the lookup and returns the channel its single answer arrives on.
pub fn fetch_billing_accounts(demo: bool) -> Receiver<Result<Vec<BillingAccount>, String>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = if demo { demo_billing_accounts() } else { list_open_billing_accounts() };
        let _ = tx.send(result);
    });
    rx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gcloud_json() {
        let json = r#"[
            {"name": "billingAccounts/01A2B3-C4D5E6-F7A8B9", "displayName": "My Billing", "open": true},
            {"name": "billingAccounts/0F1E2D-3C4B5A-697887", "open": true}
        ]"#;
        let accounts = parse_billing_accounts(json).unwrap();
        assert_eq!(accounts[0], BillingAccount { id: "01A2B3-C4D5E6-F7A8B9".into(), name: "My Billing".into() });
        assert_eq!(accounts[1].name, "0F1E2D-3C4B5A-697887");
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_billing_accounts("not json").is_err());
    }
}
