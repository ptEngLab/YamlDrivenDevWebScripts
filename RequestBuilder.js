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

            // First try TokenManager's extracted values
            const tokenFromManager = tokenManager.getToken(tokenName);
            if (tokenFromManager) {
                load.log("Retrieved from token manager");
                return tokenFromManager;
            }


            // then try LoadRunner's extracted values
            if (load.extractors && load.extractors[tokenName]) {
                return load.extractors[tokenName];
            }
            // Fallback to environment or other tokens if needed
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

    executeApiRequests(apiList) {
        for (const apiConfig of apiList) {
            const txn = new load.Transaction(apiConfig.name);
            try {
                const request = this.build(apiConfig);
                txn.start();
                const response = request.sendSync();

            } catch (error) {
                load.log(`API request failed: ${apiConfig.name} - ${error.message}`, load.LogLevel.error);
            } finally {
                txn.stop();
            }

            this._handleAuthResponse(apiConfig);

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