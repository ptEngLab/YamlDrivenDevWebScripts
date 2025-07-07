const tokenManager = require('./TokenManager');
const JS = require("./jsrsasign");

class RequestBuilder {
    constructor(configParser) {
        this._requestCounter = 1;
        this._configParser = configParser; // Injected dependency
        load.log('RequestBuilder initialized', load.LogLevel.debug);
    }

    _configureTransport(apiConfig) {

        if (!apiConfig.transport_cert) return;

        const { cert_path, key_path, password } = apiConfig.transport_cert;
        password ?
            load.setUserCertificate(cert_path, key_path, this._unmaskSentiveData(password))
            : load.setUserCertificate(cert_path, key_path);

        load.log(`Transport certificate configured for ${apiConfig.name}`, load.LogLevel.debug);

    }

    _configureUserAuthentication(apiConfig) {
        if (!apiConfig.auth_credentials) return

        try {
            const { username, password, domain, host } = apiConfig.auth_credentials;

            if (!username | !password) {
                throw new Error("Missing username or password");
            }

            const auth_record = {
                username: this._unmaskSentiveData(username),
                password: this._unmaskSentiveData(password),
                host: host || "*"
            };

            if (domain) {
                auth_record.domain = domain;
            }

            load.setUserCredentials(auth_record);

        } catch (error) {

            load.log(`Failed to configure authentication: ${error.message}`, load.LogLevel.debug);
            throw (error);

        }
    }

    _unmaskSentiveData(text) {
        if (typeof text != 'string') return text;

        try {
            if (text.startsWith('ENC:')) {
                const encryptedValue = text.substring(4);
                return load.unmask(encryptedValue);
            }

            if (text.startsWith('B64')) {
                const encryptedValue = text.substring(4);
                return Buffer.from(encryptedValue, 'base64').toString('utf8');
            }
        } catch (error) {
            load.log(`Failed to unmask or decode value: ${error.message}`, load.LogLevel.error);
        }
    }

    _deepUnmask(obj) {
        if (typeof obj === 'string') {
            return this._unmaskSentiveData(obj);
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this._deepUnmask(item));
        }

        if (typeof obj === 'object' && obj != null) {
            const result = {};

            for (const key in obj) {
                result[key] = this._deepUnmask(obj[key]);
            }
            return result;
        }

        return obj;
    }

    _createExtractors(apiConfig) {
        const extractorsList = [];
        const mapping = apiConfig.response_mapping?.extractors || {};

        for (const [paramName, extractorConfig] of Object.entries(mapping)) {
            const { type, rule } = extractorConfig;

            switch (type) {
                case 'regex': {
                    if (typeof rule === 'string') {
                        extractorsList.push(new load.RegexpExtractor(paramName, rule));
                    } else {
                        extractorsList.push(new load.RegexpExtractor(paramName, {
                            expression: rule.expression,
                            flags: rule.flags,
                            groupNumber: rule.groupNumber,
                            occurrence: rule.occurrence,
                            includeRedirections: rule.includeRedirections,
                            scope: rule.scope ? load.ExtractorScope[rule.scope] : undefined,
                            converters: rule.converters,
                            transform: rule.transform
                        }));
                    }
                    break;
                }

                case 'jsonPath': {
                    if (typeof rule === 'string') {
                        extractorsList.push(new load.JsonPathExtractor(paramName, rule));
                    } else {
                        extractorsList.push(new load.JsonPathExtractor(paramName, {
                            path: rule.path,
                            returnMultipleValues: rule.returnMultipleValues,
                            converters: rule.converters,
                            transform: rule.transform
                        }));
                    }
                    break;
                }

                case 'xpath': {
                    if (typeof rule === 'string') {
                        extractorsList.push(new load.XpathExtractor(paramName, rule));
                    } else {
                        extractorsList.push(new load.XpathExtractor(paramName, {
                            path: rule.path,
                            returnMultipleValues: rule.returnMultipleValues,
                            converters: rule.converters,
                            transform: rule.transform
                        }));
                    }
                    break;
                }

                case 'boundary': {
                    if (typeof rule === 'object') {
                        extractorsList.push(new load.BoundaryExtractor(paramName, {
                            leftBoundary: rule.leftBoundary,
                            rightBoundary: rule.rightBoundary,
                            scope: rule.scope ? load.ExtractorScope[rule.scope] : undefined,
                            occurrence: rule.occurrence,
                            includeRedirections: rule.includeRedirections,
                            failOn: rule.failOn,
                            converters: rule.converters,
                            transform: rule.transform
                        }));
                    }
                    break;
                }

                case 'textCheck': {
                    if (typeof rule === 'string') {
                        extractorsList.push(new load.TextCheckExtractor(paramName, rule));
                    } else {
                        extractorsList.push(new load.TextCheckExtractor(paramName, {
                            text: rule.text,
                            scope: rule.scope ? load.ExtractorScope[rule.scope] : undefined,
                            includeRedirections: rule.includeRedirections,
                            failOn: rule.failOn,
                            converters: rule.converters,
                            transform: rule.transform
                        }));
                    }
                    break;
                }

                default:
                    load.log(`Unknown extractor type: ${type}`, load.LogLevel.error);
            }
        }

        return extractorsList;
    }

    _replaceTokens(text) {
        if (typeof text !== 'string') return text;

        return text.replace(/\$\{([^}]+)\}/g, (match, tokenName) => {

            if (load.params && load.params[tokenName]) {
                load.log(`Token '${tokenName} retrieved from parameters`, load.LogLevel.trace);
                const paramValue = load.params[tokenName];
                return this._unmaskSentiveData(paramValue);
            }
            // Only try TokenManager for tokens it actually manages
            if (tokenManager.isManagedToken(tokenName)) {
                try {
                    const tokenFromManager = tokenManager.getToken(tokenName);
                    if (tokenFromManager) {
                        load.log(`Retrieved managed token ${tokenName} from TokenManager`, load.LogLevel.trace);
                        return tokenFromManager;
                    }
                } catch (error) {
                    load.log(`Failed to get managed token ${tokenName}: ${error.message}`, load.LogLevel.warning);
                }
            }

            // For all tokens (managed or not), try extractors
            if (load.extractors?.[tokenName]) {
                load.log(`Retrieved token ${tokenName} from extractors`, load.LogLevel.trace);
                return load.extractors[tokenName];
            }

            // Fallback to environment variables
            if (process.env[tokenName]) {
                load.log(`Retrieved ${tokenName} from environment variables`, load.LogLevel.trace);
                return process.env[tokenName];
            }

            // If nothing found, return the original match (don't fail)
            load.log(`Token ${tokenName} not found in any source`, load.LogLevel.debug);
            return match;
        });
    }

    _processUrl(url) {
        if (!url) return url;
        return this._replaceTokens(
            this._unmaskSentiveData(url)
        );
    }

    _processHeaders(headers) {
        const processed = {};
        for (const [key, value] of Object.entries(headers)) {
            processed[key] = this._replaceTokens(value);
        }
        return processed;
    }

    _processPayload(payload) {
        if (!payload) return null;

        try {
            const payloadStr = typeof payload === 'object'
                ? JSON.stringify(payload)
                : String(payload);

            const replaced = this._replaceTokens(payloadStr);

            const parsed = typeof payload === 'object'
                ? JSON.parse(replaced)
                : replaced;

            return this._deepUnmask(parsed);

        } catch (error) {
            load.log(`Payload processing failed: ${error.message}`, load.LogLevel.error);
            return payload;
        }
    }

    _handleAuthResponse(apiConfig) {
        if (!this._configParser.isAuthApi(apiConfig)) return;
        load.log(`Session established via ${apiConfig.name}`, load.LogLevel.trace);
        const extractors = apiConfig.response_mapping?.extractors;
        if (extractors) {
            for (const tokenName of Object.keys(extractors)) {
                const tokenValue = load.extractors?.[tokenName];
                if (tokenValue) {
                    const expiresIn = load.extractors?.expires_in || load.extractors?.expiry_in || (5 * 60); // default to 5 min
                    tokenManager.setToken('access_token', tokenValue, expiresIn);
                    load.log(`Token ${tokenName} extracted and stored from ${apiConfig.name}`, load.LogLevel.debug);
                } else {
                    load.log(`Token ${tokenName} not found in extractors`, load.LogLevel.warning);
                }
            }
        }
    }

    _createJWT(apiConfig) {
        if (apiConfig.jwt_config) {

            const header = {
                kid: apiConfig.jwt_config.signing_key_id,
                typ: "JWS",
                alg: "PS256"
            };

            const now_date = Math.floor(Date.now() / 1000);
            const exp_date = now_date + 600; // 10 min validity default

            const data = {
                aud: apiConfig.url,
                sub: apiConfig.payload.client_id,
                iss: apiConfig.payload.client_id,
                scope: apiConfig.payload?.scope || "",
                iat: now_date,
                exp: exp_date,
                jti: load.utils.uuid()
            };

            const sHeader = JSON.stringify(header);
            const sPayload = JSON.stringify(data);
            const signing_private_key = this._getSigningPrivateKey(apiConfig.jwt_config);

            try {
                const jwt_token = JS.KJUR.jws.JWS.sign('PS256', sHeader, sPayload, signing_private_key);
                tokenManager.setToken('jwt_token', jwt_token, 600);
            } catch (error) {
                load.log(`JWT creation failed: ${error.message}`, load.LogLevel.error);
            }
        }
    }

    _getSigningPrivateKey(jwt_config) {
        const keySource = jwt_config.signing_private_key || jwt_config.signing_cert;
        if (!keySource) {
            load.log(`No signing key or certificate provided`, load.LogLevel.error);
            return null;
        }
        try {
            if (typeof keySource === 'string') {
                return this._unmaskSentiveData(keySource);
            }
            if (typeof keySource === 'object' && keySource.key_path) {
                const keyFile = new load.File(keySource.key_path);
                const keyContent = keyFile.read().content;
                const password = keySource.password ? this._unmaskSentiveData(keySource.password) : undefined;
                return password ? JS.KEYUTIL.getKey(keyContent, password) : JS.KEYUTIL.getKey(keyContent);
            }
            load.log("Unsupported key format provided", load.LogLevel.error);
            return null;
        } catch (error) {
            load.log(`Error occurred while extracting signing private key: ${error.message}`, load.LogLevel.error);
            return null;
        }
    }

    /**
 * Builds a LoadRunner WebRequest with proper extractors and token handling
 * @param {Object} apiConfig - API configuration from YAML
 * @returns {load.WebRequest} Configured request
 */
    build(apiConfig) {
        const requestId = this._requestCounter++;
        this._configureTransport(apiConfig);
        this._configureUserAuthentication(apiConfig);
        this._createJWT(apiConfig);
        const url = this._processUrl(apiConfig.url);
        const method = (apiConfig.method || 'GET').toUpperCase();
        const headers = this._processHeaders(apiConfig.headers || {});
        const payload = this._processPayload(apiConfig.payload);
        const extractors = this._createExtractors(apiConfig);
        const disableRedirection = apiConfig.disableRedirection || false;

        const request = new load.WebRequest({
            id: requestId,
            name: apiConfig.name || `request_${requestId}`,
            url: url,
            method: method,
            headers: headers,
            body: payload,
            disableRedirection: disableRedirection,
            extractors: extractors
        });

        load.log(`Built request #${requestId}: ${apiConfig.name}`, load.LogLevel.debug);
        return request;
    }



    /**
 * Executes a list of API requests
 * @param {Array} apiList - List of API configurations to execute
 */

    executeApiRequestss(apiList) {
        for (const apiConfig of apiList) {
            const txn = new load.Transaction(apiConfig.name);
            try {
                const request = this.build(apiConfig);
                txn.start();
                const response = request.sendSync();
                txn.stop();
            } catch (error) {
                load.log(`API request failed: ${apiConfig.name} - ${error.message}`, load.LogLevel.error);
            }

            this._handleAuthResponse(apiConfig);

        }
    }

    executeApiRequests(apiList) {
        for (const apiConfig of apiList) {
            const txn = new load.Transaction(apiConfig.name);
            let transactionStatus = load.TransactionStatus.Passed; // Default to passed

            try {
                const request = this.build(apiConfig);

                // Start transaction timing
                txn.start();
                load.log(`Transaction '${apiConfig.name}' started`, load.LogLevel.debug);

                const response = request.sendSync();

                // Handle successful auth responses
                this._handleAuthResponse(apiConfig);

            } catch (error) {
                // Log error and ensure status is failed
                transactionStatus = load.TransactionStatus.Failed;
                load.log(`API request failed: ${apiConfig.name} - ${error.message}`, load.LogLevel.error);

            } finally {
                // Always stop the transaction with proper status
                txn.stop(transactionStatus);
            }
        }
    }


}

module.exports = RequestBuilder;