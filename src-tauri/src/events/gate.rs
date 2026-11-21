//! Pure resync gate: one ordered stream with snapshot-before-events (P21).

use crate::events::model::{HubEvent, HubMessage, SessionInfo};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    ListSessions,
}

enum GateState {
    Live,
    Resyncing { buffer: Vec<HubEvent>, again: bool },
}

/// Owns the epoch and guarantees that a snapshot precedes the events that
/// arrived while `session.list` was in flight.
pub struct ResyncGate {
    epoch: u64,
    generation: u64,
    state: GateState,
}

impl Default for ResyncGate {
    fn default() -> Self {
        Self::new()
    }
}

impl ResyncGate {
    pub fn new() -> Self {
        Self {
            epoch: 0,
            generation: 0,
            state: GateState::Live,
        }
    }

    /// Called once for each new connection.
    pub fn begin(&mut self, generation: u64) -> Action {
        self.epoch += 1;
        self.generation = generation;
        self.state = GateState::Resyncing {
            buffer: Vec::new(),
            again: false,
        };
        Action::ListSessions
    }

    /// `events.dropped` or the UI's `session_resync`. While already resyncing,
    /// the buffered events predate the gap and are discarded; the caller will
    /// be asked for a second list when the current one returns.
    pub fn request_resync(&mut self) -> Option<Action> {
        match &mut self.state {
            GateState::Live => {
                self.epoch += 1;
                self.state = GateState::Resyncing {
                    buffer: Vec::new(),
                    again: false,
                };
                Some(Action::ListSessions)
            }
            GateState::Resyncing { buffer, again } => {
                buffer.clear();
                *again = true;
                None
            }
        }
    }

    pub fn on_event(&mut self, event: HubEvent) -> Vec<HubMessage> {
        match &mut self.state {
            GateState::Live => vec![HubMessage::Event {
                epoch: self.epoch,
                generation: self.generation,
                event,
            }],
            GateState::Resyncing { buffer, .. } => {
                buffer.push(event);
                Vec::new()
            }
        }
    }

    /// Corporate `devices.presence` resync is DT-15; this gate only owns
    /// `session.list` ordering for now.
    pub fn on_sessions(&mut self, sessions: Vec<SessionInfo>) -> (Vec<HubMessage>, Option<Action>) {
        let (again, buffer) = match &mut self.state {
            GateState::Live => return (Vec::new(), None),
            GateState::Resyncing { buffer, again } => (*again, std::mem::take(buffer)),
        };
        if again {
            self.state = GateState::Resyncing {
                buffer: Vec::new(),
                again: false,
            };
            return (Vec::new(), Some(Action::ListSessions));
        }
        let mut messages = vec![HubMessage::Snapshot {
            epoch: self.epoch,
            generation: self.generation,
            sessions,
        }];
        messages.extend(buffer.into_iter().map(|event| HubMessage::Event {
            epoch: self.epoch,
            generation: self.generation,
            event,
        }));
        self.state = GateState::Live;
        (messages, None)
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
