# API Configuration (`api_config.yaml`) Documentation

## Overview

The `api_config.yaml` file defines API endpoints, their configurations, and processing rules for the RequestBuilder system. The YAML must have an `api_config` root element containing all API definitions.

---

## Structure

```yaml
api_config:
    api_key_name_1:
        # API configuration
    api_key_name_2:
        # API configuration
    api_key_name_3:
        # API configuration
    # ...
```

---

## Common Configuration Fields

### Required Fields

- **name**: (String) Descriptive name for the API request
- **url**: (String) Endpoint URL (supports tokens like `${token_name}`)

### Optional Fields

- **method**: (String) HTTP method (default: `"GET"`)
- **phase**: (String) Test phase (`"initialize"`, `"action"`, `"finalize"`; default: `"action"`)
- **depends_on**: (String) Name of another API this request depends on
- **is_auth_api**: (Boolean) Marks as authentication API (default: `false`)
- **disableRedirection**: (Boolean) Disable HTTP redirection (default: `false`)
- **headers**: (Object) HTTP headers as key-value pairs
- **payload**: (Object/String) Request payload (auto-processed if JSON)

---

## Authentication Configuration

### Basic Authentication

```yaml
auth_credentials:
    username: "user"      # or "ENC:..." for encrypted
    password: "pass"      # or "ENC:..." for encrypted
    domain: "domain"      # optional
    host: "hostname"      # optional, default "*"
```

### Transport Certificate

```yaml
transport_cert:
    cert_path: "/path/to/cert.pem"
    key_path: "/path/to/key.pem"
    password: "passphrase"  # optional, can be encrypted
```

### JWT Configuration

```yaml
jwt_config:
    signing_key_id: "key-identifier"
    signing_private_key: "key-content"
    # OR
    signing_cert:
        key_path: "/path/to/key.pem"
        password: "passphrase"  # optional, can be encrypted
```

---

## Response Processing

### Extractors Configuration

```yaml
response_mapping:
    extractors:
        variable_name_1:
            type: "regex"      # or "jsonPath", "xpath", "boundary", "textCheck"
            rule: "pattern"    # or configuration object
        variable_name_2:
            type: "jsonPath"
            rule: "$.path.to.value"
```

#### Extractor Types

1. **Regex Extractor**
   ```yaml
        type: "regex"
        rule: "pattern"
        # OR
        rule:
            expression: "pattern"
            flags: "i"           # optional
            groupNumber: 1       # optional
            occurrence: 1        # optional
            includeRedirections: false  # optional
            scope: "Body"        # optional. supported values: Body, Headers, All: Defualt is Body
    ```


2. **JSON Path Extractor**
    ```yaml
        type: "jsonPath"
        rule: "$.path.to.value"
        # OR
        rule:
            path: "$.path.to.value"
            returnMultipleValues: false  # optional
    ```

3. **XPath Extractor**
    ```yaml
        type: "xpath"
        rule: "//path/to/node"
        # OR
        rule:
            path: "//path/to/node"
            returnMultipleValues: false  # optional
    ```

4. **Boundary Extractor**
    ```yaml
        type: "boundary"
        rule:
            leftBoundary: "start"
            rightBoundary: "end"
            scope: "Body"        # optional. supported values: Body, Headers, All: Defualt is Body
            occurrence: 1        # optional
    ```

5. **Text Check Extractor**
    ```yaml
        type: "textCheck"
        rule: "expected text"
        # OR
        rule:
            text: "My Text to check"
            scope: "Body"        # optional
            failOn: "false"    # optional. Check the body for the text "My Text to check" but fail the iteration if the text isn't found
    ```

---

## Example Configuration

```yaml
api_config:
    auth_api:
        name: "Authentication API"
        url: "https://api.example.com/oauth/token"
        method: "POST"
        phase: "initialize"
        is_auth_api: true
        headers:
            Content-Type: "application/x-www-form-urlencoded"
        payload:
            grant_type: "password"
            username: "ENC:encrypted_username"
            password: "ENC:encrypted_password"
        response_mapping:
            extractors:
                access_token:
                    type: "jsonPath"
                    rule: "$.access_token"
                expires_in:
                    type: "jsonPath"
                    rule: "$.expires_in"

    get_users:
        name: "Get Users"
        url: "https://api.example.com/users"
        method: "GET"
        depends_on: "Authentication API"
        headers:
            Authorization: "Bearer ${access_token}"
        response_mapping:
            extractors:
                user_count:
                    type: "jsonPath"
                    rule: "$.users.length"
```

---

## Notes

1. Sensitive values can be encrypted using `ENC:` or base64 encoded with `B64:`
2. Token Plceholder replacement is supported in URLs, headers, and payloads using `${token_name}`
3. Token lookup order:
     - LoadRunner parameters
     - TokenManager (managed tokens)
     - Extractors
     - Environment variables
