//! A single-line text field with a cursor, optionally masked.

#[derive(Debug, Clone, Default)]
pub struct TextInput {
    value: String,
    cursor: usize,
    pub masked: bool,
}

impl TextInput {
    pub fn masked() -> Self {
        Self { masked: true, ..Self::default() }
    }

    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn set(&mut self, value: &str) {
        self.value = value.to_string();
        self.cursor = self.len();
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    fn len(&self) -> usize {
        self.value.chars().count()
    }

    fn byte_index(&self, char_index: usize) -> usize {
        self.value
            .char_indices()
            .nth(char_index)
            .map(|(i, _)| i)
            .unwrap_or(self.value.len())
    }

    pub fn insert(&mut self, c: char) {
        if c.is_control() {
            return;
        }
        let at = self.byte_index(self.cursor);
        self.value.insert(at, c);
        self.cursor += 1;
    }

    /// Inserts pasted text, dropping newlines and other control characters.
    pub fn paste(&mut self, text: &str) {
        text.chars().for_each(|c| self.insert(c));
    }

    pub fn backspace(&mut self) {
        if self.cursor == 0 {
            return;
        }
        self.cursor -= 1;
        let at = self.byte_index(self.cursor);
        self.value.remove(at);
    }

    pub fn delete(&mut self) {
        if self.cursor < self.len() {
            let at = self.byte_index(self.cursor);
            self.value.remove(at);
        }
    }

    pub fn left(&mut self) {
        self.cursor = self.cursor.saturating_sub(1);
    }

    pub fn right(&mut self) {
        self.cursor = (self.cursor + 1).min(self.len());
    }

    pub fn home(&mut self) {
        self.cursor = 0;
    }

    pub fn end(&mut self) {
        self.cursor = self.len();
    }

    /// What the screen shows: bullets for a masked field unless revealed.
    pub fn display(&self, reveal: bool) -> String {
        if self.masked && !reveal {
            "•".repeat(self.len())
        } else {
            self.value.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_around_the_cursor_with_multibyte_text() {
        let mut input = TextInput::default();
        input.paste("ışık");
        input.left();
        input.backspace();
        assert_eq!(input.value(), "ışk");
        input.home();
        input.insert('a');
        assert_eq!(input.value(), "aışk");
        input.end();
        input.delete();
        assert_eq!(input.value(), "aışk");
    }

    #[test]
    fn paste_drops_control_characters() {
        let mut input = TextInput::default();
        input.paste("gsk_abc\n\tdef");
        assert_eq!(input.value(), "gsk_abcdef");
    }

    #[test]
    fn masks_unless_revealed() {
        let mut input = TextInput::masked();
        input.set("secret");
        assert_eq!(input.display(false), "••••••");
        assert_eq!(input.display(true), "secret");
    }
}
