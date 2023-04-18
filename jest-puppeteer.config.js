module.exports = {
    launch: {
        dumpio: true,
        headless: false,
        product: "chrome",
        devtools: true
    },
    server: {
        command: "yarn start",
        port: 8081,
        launchTimeout: 10000,
        debug: true,
    },

    browserContext: "default",
};