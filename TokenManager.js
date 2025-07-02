class TokenManager {
    constructor() {
        this.tokens = {};
        this.tokenDependencies = {};
        this.configParser = null; // Will be set during initialization
        load.log('TokenManager initialized', load.LogLevel.debug);
    }

    // Initialize with config parser reference
    init(configParser) {
        this.configParser = configParser;
    }

    setToken(tokenName, tokenValue, expiresIn) {
        const expirationTime = new Date();
        expirationTime.setSeconds(expirationTime.getSeconds() + expiresIn - 60); // 60-second buffer

        this.tokens[tokenName] = {
            value: tokenValue,
            expiresAt: expirationTime
        };

        load.log(`Token ${tokenName} set to expire at ${expirationTime}`, load.LogLevel.debug);
    }

    getToken(tokenName) {
        // First check if we have a valid token
        if (this.isTokenValid(tokenName)) {
            return this.tokens[tokenName].value;
        }

        if (!this.configParser) {
            throw new Error('ConfigParser not initialized - call init() first');
        }

        // Get auth API config - guaranteed to exist because we validated earlier
        const loginApiConfig = this.configParser.getAuthApiConfig();

        load.log(`Renewing expired/missing token by calling ${loginApiConfig.name}`, load.LogLevel.info);

        const requestBuilder = new RequestBuilder();
        const loginRequest = requestBuilder.build(loginApiConfig);
        const response = loginRequest.sendSync();

        if (response.statusCode !== 200) {
            throw new Error(`Authentication failed with status ${response.statusCode}`);
        }

        const tokenValue = load.extractors?.access_token;
        const expiresIn = load.extractors?.expiry_in || (2 * 60);

        if (!tokenValue) {
            throw new Error('No access token received in authentication response');
        }

        this.setToken(tokenName, tokenValue, expiresIn);
        return tokenValue;
    }

    isTokenValid(tokenName) {
        const token = this.tokens[tokenName];
        if (!token) {
            load.log(`Token ${tokenName} not found`, load.LogLevel.debug);
            return false;
        }

        if (new Date() > token.expiresAt) {
            load.log(`Token ${tokenName} expired at ${token.expiresAt}`, load.LogLevel.debug);
            return false;
        }

        load.log(`Token ${tokenName} will expire at ${token.expiresAt}`, load.LogLevel.debug);

        return true;
    }

    registerDependency(apiName, dependsOn) {
        this.tokenDependencies[apiName] = dependsOn;
        load.log(`Registered dependency: ${apiName} depends on ${dependsOn}`, load.LogLevel.trace);
    }

    getDependency(apiName) {
        const dependency = this.tokenDependencies[apiName];
        load.log(`Retrieved dependency for ${apiName}: ${dependency}`, load.LogLevel.trace);
        return dependency;
    }
}

module.exports = new TokenManager();