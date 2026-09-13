# penpeita CAPTCHA test

A temporary AWS WAF CAPTCHA test page: enter the privately shared 300-digit password, solve the AWS WAF puzzle, then see the success result.

Current status: the password screen is ready; AWS CAPTCHA configuration is pending.

Only static assets are published here. The password is distributed separately. CAPTCHA integration settings are encrypted in config.js. No AWS IAM credentials belong in this repository.

This client-side encryption keeps the integration settings out of plaintext public files. It is not server-side authorization: an authorized visitor can inspect the decrypted settings. Revoke the CAPTCHA key and remove test-only AWS resources after testing.
