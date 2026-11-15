# Public credential incident response

Historical public files contained a static LLM Todo mobile/web API token
and an ADC email/password embedded in scripts. Those literals are removed
from current source, but Git history and downloaded copies remain exposed.

Required operator actions:
- Revoke and rotate the LLM Todo API token used by the mobile integration.
- Rotate the ADC password embedded in QA and role scripts, revoke active
  sessions, and review sign-in/access logs.
- Supply ADC_EMAIL and ADC_PASSWORD through private environment variables
  or an ignored local .env. Provision SSH known_hosts before running scripts.
- Set a newly issued token in SecureStore for native clients. Web clients
  need a backend-authenticated session, never bundled shared credentials.
- Scrub all affected values from Git history, tags, and release artifacts.
