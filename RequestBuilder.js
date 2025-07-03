const tokenManager = require('./TokenManager');

class RequestBuilder {
    constructor(configParser) {
        this._requestCounter = 1;
        this._configParser = configParser; // Injected dependency
        load.log('RequestBuilder initialized', load.LogLevel.debug);
    }

    /**
     * Builds a LoadRunner WebRequest with proper extractors and token handling
     * @param {Object} apiConfig - API configuration from YAML
     * @returns {load.WebRequest} Configured request
     */
    build(apiConfig) {
        const requestId = this._requestCounter++;

        // Create extractors first so they're available for token replacement
        const extractors = this._createExtractors(apiConfig);

        // Process the request with token replacement
        const request = new load.WebRequest({
            id: requestId,
            name: apiConfig.name || `request_${requestId}`,
            url: apiConfig.url,
            method: (apiConfig.method || 'GET').toUpperCase(),
            headers: this._processHeaders(apiConfig.headers || {}),
            body: this._processPayload(apiConfig.payload),
            extractors
        });

        load.log(`Built request #${requestId}: ${apiConfig.name}`, load.LogLevel.debug);
        return request;
    }

    _createExtractors(apiConfig) {
        const extractorsList = [];
        const mapping = apiConfig.response_mapping?.extractors || {};

        for (const [paramName, jsonPath] of Object.entries(mapping)) {
            try {
                extractorsList.push(new load.JsonPathExtractor(paramName, jsonPath));
                load.log(`Added extractor: ${paramName} = ${jsonPath}`, load.LogLevel.trace);
            } catch (error) {
                load.log(`Failed to create extractor ${paramName}: ${error.message}`, load.LogLevel.warning);
            }
        }

        return extractorsList;
    }

    _replaceTokens(text) {
        if (typeof text !== 'string') return text;

        return text.replace(/\$\{([^}]+)\}/g, (match, tokenName) => {
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

            const processed = this._replaceTokens(payloadStr);

            return typeof payload === 'object'
                ? JSON.parse(processed)
                : processed;
        } catch (error) {
            load.log(`Payload processing failed: ${error.message}`, load.LogLevel.error);
            return payload;
        }
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
    _handleAuthResponse(apiConfig) {
        if (!this._configParser.isAuthApi(apiConfig)) return;

        // Session-based by default
        load.log(`Session established via ${apiConfig.name}`, load.LogLevel.debug);

        // Only handle tokens if response_mapping.extractors contains token fields
        if (apiConfig.response_mapping?.extractors) {
            const isTokenAuth = Object.keys(apiConfig.response_mapping.extractors).some(
                key => key.includes('token') || key.includes('access_token')
            );

            if (isTokenAuth) {
                const tokenValue = load.extractors?.access_token ||
                    load.extractors?.token;
                const expiresIn = load.extractors?.expires_in ||
                    load.extractors?.expiry_in ||
                    (2 * 60);

                if (tokenValue) {
                    tokenManager.setToken('access_token', tokenValue, expiresIn);
                    load.log(`Token extracted and stored from ${apiConfig.name}`, load.LogLevel.debug);
                } else {
                    load.log(`Configured token fields not found in auth response`, load.LogLevel.warning);
                }
            }
        }
    }

}

module.exports = RequestBuilder;