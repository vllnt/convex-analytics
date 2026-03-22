# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report security issues via [GitHub Security Advisories](https://github.com/bntvllnt/convex-analytics/security/advisories).

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Scope

- API key handling and authentication bypass
- Rate limiter bypass
- Data exposure (leaking user data across projects/tenants)
- Injection via event properties or names
- GDPR deletion completeness

### Response Timeline

- **48 hours**: Acknowledge receipt
- **7 days**: Initial assessment and severity classification
- **30 days**: Fix or mitigation for critical/high severity

### Out of Scope

- Denial of service via high event volume (use rate limiting configuration)
- Issues in dependencies (report upstream)
- Issues requiring physical access to infrastructure
