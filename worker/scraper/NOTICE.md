# Vendored code notice

`contact_scraper/` is a modified copy of **omkarcloud/website-email-contact-scraper**
(https://github.com/omkarcloud/website-email-contact-scraper), MIT licence, Copyright (c) 2024-2025 Chetan Jain
(see `LICENSE-omkarcloud`).

- Copied at commit `d6a92b92f08a9740535de5f2dd6c6fb27ad7a0d8` (2026-10-14), after a read-through of every non-test source file.
  The audit found no code execution, no telemetry and no outbound calls other than to the sites being scraped.
- Changes made by Dreamlabs:
  - `compat.py` added: replaces the three `botasaurus` helpers that were imported (`IS_DOCKER`, `IS_IN_KUBERNETES`, `get_os`, `save_error_logs`).
  - `api.py`: removed the `botasaurus` `@task` decorator and its import.
  - `chrome_manager.py`, `patchright_driver.py`: import the helpers from `compat` instead of `botasaurus`.
  - `test_integration.py` not copied (needs botasaurus and the live internet).
- NOT used: the original `botasaurus-server`, its React frontend, its Dockerfile and its third-party base image.
- Dependencies are pinned with hashes in `requirements.lock`; the image is built from the official `python` image.
