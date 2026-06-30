# Heartbeat Feedback Consumption

## Overview
Each Agent HEARTBEAT.md should include a feedback consumption step to check for pending feedback notifications.

## Implementation

### In HEARTBEAT.md, add this section:

```markdown
### 🔄 Feedback Consumption
Check for pending feedback events from the ADC feedback_events system:
- GET /api/requirements/mine/feedback — check for unread feedback notifications
- If feedback exists, log consumption in heartbeat report
- Dependencies: Requires feedback_events system (F2 requirement)
```

### Automated Check (optional)
Add a script that runs during heartbeat to check for feedback events.

## API
- `GET /api/requirements/mine/feedback` — Returns feedback events for the current user
- The response includes: `{ data: [{ id, type, content, createdAt, read }] }`
