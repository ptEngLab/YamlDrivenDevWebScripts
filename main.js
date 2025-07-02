const requestBuilder = require('./RequestBuilder');
const tokenManager = require('./TokenManager');
const ConfigParser = require('./ConfigParser');

let config = new ConfigParser('api_config.yaml');
const reqBuilder = new requestBuilder(config);
tokenManager.init(config);

load.initialize('Initialize', async function () {

    const apis = config.getApisByPhase(load.config.stage);
    reqBuilder.executeApiRequests(apis);

});

load.action('Action', async function () {

    const apis = config.getApisByPhase(load.config.stage);
    reqBuilder.executeApiRequests(apis);

});

load.finalize('Finalize', async function () {

    const apis = config.getApisByPhase(load.config.stage);
    reqBuilder.executeApiRequests(apis);

});
