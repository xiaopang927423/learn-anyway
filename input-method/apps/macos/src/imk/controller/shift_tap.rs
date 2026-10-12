//! Solo Shift switching tolerates duplicate IMK delivery; chords and dual Shift cancel the tap.
#[derive(Default)]
pub(super) struct ShiftTap {
    pending: Option<(u16, f64)>,
    blocked: bool,
}
impl ShiftTap {
    /// Focus/session reset: no key state carries to a new field.
    pub fn cancel(&mut self) {
        self.pending = None;
        self.blocked = false;
    }
    /// A key/chord used while Shift is down cannot be rearmed by duplicate flags.
    pub fn interrupt(&mut self) {
        self.blocked |= self.pending.is_some();
        self.pending = None;
    }
    pub fn flags(&mut self, key: u16, shift: bool, other: bool, timestamp: f64) -> bool {
        if !shift {
            let pending = self.pending.take();
            let blocked = std::mem::take(&mut self.blocked);
            return !blocked
                && !other
                && pending.is_some_and(|(pressed, started)| {
                    pressed == key && (0.0..=0.6).contains(&(timestamp - started))
                });
        }
        if !matches!(key, 56 | 60) || other {
            self.interrupt();
            return false;
        }
        if self.blocked {
            return false;
        }
        match self.pending {
            Some((pressed, _)) if pressed == key => {} // IMK may forward the same transition twice.
            Some(_) => self.interrupt(),               // Both physical Shift keys: not a solo tap.
            None => self.pending = Some((key, timestamp)),
        }
        false
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn solo_shift_only() {
        let mut tap = ShiftTap::default();
        assert!(!tap.flags(56, true, false, 1.));
        assert!(tap.flags(56, false, false, 1.1));
        assert!(!tap.flags(56, false, false, 1.2));
        tap.flags(60, true, false, 2.);
        tap.interrupt();
        assert!(!tap.flags(60, false, false, 2.1));
        tap.flags(56, true, false, 3.);
        assert!(!tap.flags(56, false, false, 4.));
        tap.flags(56, true, false, 5.);
        tap.flags(59, true, true, 5.1);
        assert!(!tap.flags(56, false, false, 5.2));
        tap.flags(56, true, false, 6.);
        tap.flags(60, true, false, 6.1);
        assert!(!tap.flags(56, false, false, 6.2));
    }
    #[test]
    fn real_imk_duplicate_transitions_switch_exactly_once() {
        let mut tap = ShiftTap::default();
        assert!(!tap.flags(56, true, false, 44.480));
        assert!(!tap.flags(56, true, false, 44.485));
        assert!(tap.flags(56, false, false, 44.681));
        assert!(!tap.flags(56, false, false, 44.682));
        // A used Shift cannot rearm on another duplicate key-down transition.
        tap.flags(56, true, false, 50.);
        tap.interrupt();
        assert!(!tap.flags(56, true, false, 50.01));
        assert!(!tap.flags(56, false, false, 50.1));
        assert!(!tap.flags(56, false, false, 50.11));
        assert!(!tap.flags(60, true, false, 51.));
        assert!(!tap.flags(60, true, false, 51.01));
        assert!(tap.flags(60, false, false, 51.1));
    }
}
