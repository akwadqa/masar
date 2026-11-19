---
name: masar-move-tasks
description: Move Masar Tasks from one Space to another as an approved one-off data fix on production. Use when the user asks to move, transfer or re-home Tasks between Spaces.
---

# Moving Tasks between Spaces

Masar has no "move Task to another Space" feature: `Masar Task.space` is set only once and generic
writes to Masar DocTypes are denied, so `frappectl doc update` cannot do it. It is done as an approved
data fix in one transaction (done three times on 2026-11-11). Building a proper Workspace action was
suggested and has not been requested.

This repository is public: take the server, site and frappectl profile from the private Akwad skills
`akwad-environment` and `akwad-frappe-site` (placeholders: `<profile>`, `<bench>`).

1. **Read-only inventory** with `frappectl query -s <profile>`. Count the rows whose `space` column must
   follow the Task: Masar Task, Comment, Comment Notification, Comment Reaction, Activity
   (`reference_name`), Notification, Attachment, Time Entry, Batch Item, My Day, Timer Session and Task
   Action. Also check that labels, feature and release belong to the target Space, look for
   `source_task`/`promoted_task` links, and compare the assignees with the target Space's members.
2. **Assignees who are not members** of the target Space would lose access and block later saves. Offer
   to add them as Members (the approver chose that each time), through `space_service.add_member` run as
   a Manager of that Space whom the approver names.
3. **Ask for approval** with the exact counts per table. Then run one transaction over SSM as the bench
   user (`cd <bench>/sites`, `../env/bin/python -` with a heredoc, no file left on the server): assert
   the counts before, `frappe.db.set_value(..., update_modified=False)`, assert the counts after,
   commit, otherwise roll back.
4. **Verify** with frappectl. Tell the approver that former non-members lose access and that open tabs
   need a refresh.
