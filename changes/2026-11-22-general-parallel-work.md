# Behind the scenes: the code is split by area so several changes can be built at once

- Nothing an operator sees changes. The help guide, the technical docs, the menu, the routes, Pepper's tools, the report catalogue and the tests are now gathered from one file per area, so two changes in different areas no longer edit the same files.
- The changelog is one file per change in `changes/`; the backlog is one file per area in `docs/claude/outstanding/`.
- Test runs on one computer can each have their own database and queues (`scripts/test-env.sh`).
