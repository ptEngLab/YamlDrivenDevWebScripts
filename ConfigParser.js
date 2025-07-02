const yaml = require('js-yaml');
const tokenManager = require('./TokenManager');

class ConfigParser {
    constructor(configPath) {
        try {
            const configFile = new load.File(configPath);
            const fileContent = configFile.read({ returnContent: true }).content;

            if (!fileContent) {
                load.log(`Configuration file is empty or couldn't be read: ${configPath}`, load.LogLevel.error);
                throw new Error(`Configuration file is empty or couldn't be read: ${configPath}`);
            }

            const parsedConfig = yaml.load(fileContent);

            if (!parsedConfig || !parsedConfig.api_config) {
                load.log('Invalid YAML structure: missing api_config root element', load.LogLevel.error);
                throw new Error('Invalid YAML structure: missing api_config root element');
            }

            this.config = parsedConfig.api_config;
            this.phases = {
                initialize: [],
                action: [], // Default phase
                finalize: []
            };

            this.parseConfig();
            load.log('Configuration parsed successfully', load.LogLevel.debug);
        } catch (error) {
            load.log(`Failed to initialize ConfigParser: ${error.message}`, load.LogLevel.error);
            throw error;
        }
    }

    parseConfig() {
        try {
            for (const [apiKey, apiConfig] of Object.entries(this.config)) {
                // Validate minimum required fields
                if (!apiConfig.name) {
                    const msg = `Missing 'name' for API ${apiKey}`;
                    load.log(msg, load.LogLevel.error);
                    throw new Error(msg);
                }

                if (!apiConfig.url) {
                    const msg = `Missing 'url' for API ${apiConfig.name}`;
                    load.log(msg, load.LogLevel.error);
                    throw new Error(msg);
                }

                // Register dependencies if specified
                if (apiConfig.depends_on) {
                    if (typeof apiConfig.depends_on !== 'string') {
                        const msg = `Invalid depends_on format for API ${apiConfig.name}`;
                        load.log(msg, load.LogLevel.error);
                        throw new Error(msg);
                    }
                    tokenManager.registerDependency(apiConfig.name, apiConfig.depends_on);
                    load.log(`Registered dependency: ${apiConfig.name} depends on ${apiConfig.depends_on}`,
                           load.LogLevel.debug);
                }

                // Handle phase (default to 'action' if not specified)
                const phase = apiConfig.phase || 'action';

                if (!this.phases[phase]) {
                    const msg = `Invalid phase '${phase}' for API ${apiConfig.name}`;
                    load.log(msg, load.LogLevel.error);
                    throw new Error(msg);
                }

                // Ensure method is uppercase for consistency
                if (apiConfig.method) {
                    apiConfig.method = apiConfig.method.toUpperCase();
                }

                this.phases[phase].push(apiConfig);
                load.log(`Added API ${apiConfig.name} to phase ${phase}`, load.LogLevel.trace);
            }
        } catch (error) {
            load.log(`Failed to parse configuration: ${error.message}`, load.LogLevel.error);
            throw error;
        }
    }

    getApisByPhase(phase) {
        const apis = this.phases[phase] || [];
        load.log(`Retrieved ${apis.length} APIs for phase ${phase}`, load.LogLevel.trace);
        return apis;
    }

    getApiByName(name) {
        const api = Object.values(this.config).find(api => api.name === name);
        if (!api) {
            load.log(`API with name ${name} not found`, load.LogLevel.warning);
        }
        return api;
    }

    isAuthApi(apiConfig) {
        const isAuth = apiConfig.is_auth_api === true;
        load.log(`Checked isAuthApi for ${apiConfig.name}: ${isAuth}`, load.LogLevel.trace);
        return isAuth;
    }

        /**
     * Gets the authentication API configuration
     * @returns {Object|null} The auth API config or null if not found
     */
    getAuthApiConfig() {
        for (const apiConfig of Object.values(this.config)) {
            if (this.isAuthApi(apiConfig)) {
                return apiConfig;
            }
        }
        load.log('No authentication API found in configuration', load.LogLevel.warning);
        return null;
    }
    
    getAllApiNames() {
        const names = Object.values(this.config).map(api => api.name);
        load.log(`Retrieved all API names (count: ${names.length})`, load.LogLevel.trace);
        return names;
    }
}

module.exports = ConfigParser;