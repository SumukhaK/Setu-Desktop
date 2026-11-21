//! Pure resync gate: one ordered stream with snapshot-before-events (P21).

use crate::events::model::{HubEvent, HubMessage, SessionInfo};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    ListSessions,
}

pub struct ResyncGate;

impl ResyncGate {
    pub fn new() -> Self {
        Self
    }

    pub fn begin(&mut self, _generation: u64) -> Action {
        Action::ListSessions
    }

    pub fn request_resync(&mut self) -> Option<Action> {
        None
    }

    pub fn on_event(&mut self, _event: HubEvent) -> Vec<HubMessage> {
        Vec::new()
    }

    /// Corporate `devices.presence` resync is DT-15; this gate only owns
    /// `session.list` ordering for now.
    pub fn on_sessions(
        &mut self,
        _sessions: Vec<SessionInfo>,
    ) -> (Vec<HubMessage>, Option<Action>) {
        (Vec::new(), None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path_up(session: &str, tunnel: &str) -> HubEvent {
        HubEvent::PathUp {
            session: session.into(),
            tunnel_id: tunnel.into(),
            transport: "lan".into(),
            outage_ms: 10,
        }
    }

    fn session(s: &str) -> SessionInfo {
        SessionInfo {
            session_id: s.into(),
            adb_addr: "127.0.0.1:1".into(),
            device_id: "pixel-7".into(),
            started: "t".into(),
        }
    }

    fn snapshot_epoch(messages: &[HubMessage]) -> u64 {
        match messages.first() {
            Some(HubMessage::Snapshot { epoch, .. }) => *epoch,
            other => panic!("expected a snapshot, got {other:?}"),
        }
    }

    fn event_epoch(messages: &[HubMessage]) -> u64 {
        match messages.first() {
            Some(HubMessage::Event { epoch, .. }) => *epoch,
            other => panic!("expected an event, got {other:?}"),
        }
    }

    #[test]
    fn live_passes_events_with_the_current_epoch() {
        let mut gate = ResyncGate::new();
        assert_eq!(gate.begin(1), Action::ListSessions);
        let (messages, action) = gate.on_sessions(vec![session("s1")]);
        assert_eq!(action, None);
        assert_eq!(snapshot_epoch(&messages), 1);

        let emitted = gate.on_event(path_up("s1", "t1"));
        assert_eq!(
            emitted,
            vec![HubMessage::Event {
                epoch: 1,
                generation: 1,
                event: path_up("s1", "t1"),
            }]
        );
    }

    #[test]
    fn resync_buffers_then_emits_snapshot_before_the_events() {
        let mut gate = ResyncGate::new();
        gate.begin(1);
        let (_, _) = gate.on_sessions(vec![]);
        assert_eq!(gate.request_resync(), Some(Action::ListSessions));

        assert!(gate.on_event(path_up("s1", "t1")).is_empty());
        assert!(gate.on_event(path_up("s1", "t2")).is_empty());

        let (messages, action) = gate.on_sessions(vec![session("s1")]);
        assert_eq!(action, None);
        assert_eq!(messages.len(), 3, "snapshot plus two buffered events");
        assert_eq!(snapshot_epoch(&messages), 2);
        assert_eq!(
            messages[1],
            HubMessage::Event {
                epoch: 2,
                generation: 1,
                event: path_up("s1", "t1"),
            }
        );
        assert_eq!(
            messages[2],
            HubMessage::Event {
                epoch: 2,
                generation: 1,
                event: path_up("s1", "t2"),
            }
        );
    }

    #[test]
    fn resync_during_resync_asks_for_a_second_list_and_discards_old_events() {
        let mut gate = ResyncGate::new();
        gate.begin(1);
        assert!(gate.on_event(path_up("s1", "pre-gap")).is_empty());
        assert_eq!(gate.request_resync(), None);

        let (messages, action) = gate.on_sessions(vec![]);
        assert!(messages.is_empty());
        assert_eq!(action, Some(Action::ListSessions));

        let (messages, action) = gate.on_sessions(vec![session("s1")]);
        assert_eq!(action, None);
        assert_eq!(messages.len(), 1, "the pre-gap event was discarded");
        assert_eq!(snapshot_epoch(&messages), 1);
    }

    #[test]
    fn epoch_strictly_increases_across_begin_and_live_resyncs() {
        let mut gate = ResyncGate::new();
        gate.begin(4);
        let (messages, _) = gate.on_sessions(vec![]);
        let first = snapshot_epoch(&messages);

        assert_eq!(gate.request_resync(), Some(Action::ListSessions));
        let (messages, _) = gate.on_sessions(vec![]);
        let second = snapshot_epoch(&messages);
        assert!(second > first);

        assert_eq!(gate.request_resync(), Some(Action::ListSessions));
        let (messages, _) = gate.on_sessions(vec![]);
        let third = snapshot_epoch(&messages);
        assert!(third > second);

        let emitted = gate.on_event(path_up("s1", "t1"));
        assert!(event_epoch(&emitted) > second);
    }
}
