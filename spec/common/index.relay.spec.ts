import { Browser, Page } from "puppeteer";
import { PRIVATE_KEY } from "../data";
import { login, createBrowserAndPage, getReplayConnectCount } from "../utils";
let relayUrl = "wss://nostr.paiyaapp.com";
describe("teset relays", () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
        const result = await createBrowserAndPage();
        browser = result.browser;
        page = result.page;
        await login(page, PRIVATE_KEY);
    }, 360 * 1000);
    afterAll(async () => {
        await browser.close();
    });
    it(
        "get default replay connect count",
        async () => {
            const count = await getReplayConnectCount(page);
            expect(count).toEqual(1);
        },
        20 * 1000,
    );
    it(
        "cancel relay connect",
        async () => {
            await page.$eval(".relay-signal", (el) => {
                el.click();
            });
            await page.waitForTimeout(2 * 1000);
            await page.waitForSelector(".settings-appearance__card");
            // 取消当前的节点连接
            await page.$eval(".settings-appearance__card:nth-child(2) .toggle-margin button", (el) => {
                el.click();
            });
            await page.waitForTimeout(1 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(0);
        },
        20 * 1000,
    );
    it(
        "reconnect relay connect",
        async () => {
            await page.waitForSelector(".relay-signal");
            await page.$eval(".settings-appearance__card:nth-child(2) .toggle-margin button", (el) => {
                el.click();
            });
            await page.waitForTimeout(4 * 1000);

            await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
        },
        20 * 1000,
    );
    it(
        "add new relay",
        async () => {
            await page.waitForSelector(".relay-signal");
            await page.$eval(".settings-window__cards-wrapper .keyword-notification__keyword input", async (el) => {
                el.focus();
            });
            await page.keyboard.type(relayUrl);
            await page.$eval(".settings-window__cards-wrapper .keyword-notification__keyword button", (el) => {
                el.click();
            });
            await page.waitForTimeout(5 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(2);
        },
        20 * 1000,
    );
    it(
        "save relays",
        async () => {
            await page.$eval(
                ".settings-window__cards-wrapper .keyword-notification__keyword .relay-buttons button",
                (el) => {
                    el.click();
                },
            );
            await page.waitForTimeout(0.5 * 1000);

            let relays = await page.evaluate(() => {
                return JSON.parse(localStorage["nostr.relays"]);
            });
            expect(relays.length).toEqual(2);
            expect(relays[1].url).toEqual(relayUrl);
        },
        20 * 1000,
    );
    it(
        "reset relays",
        async () => {
            await page.$eval(
                ".settings-window__cards-wrapper .keyword-notification__keyword .relay-buttons button:nth-child(2)",
                (el) => {
                    el.click();
                },
            );
            await page.waitForSelector(".confirm-dialog__btn");

            await page.$eval(".confirm-dialog__btn button", (el) => {
                el.click();
            });
            await page.waitForTimeout(3 * 1000);

            const relays = await page.evaluate(() => {
                return JSON.parse(localStorage["nostr.relays"]);
            });
            expect(relays.length).toEqual(1);
            expect(relays[0].url).not.toEqual(relayUrl);
        },
        90 * 1000,
    );
    it(
        "delete relays",
        async () => {
            await page.$eval(".relay-signal", (el) => {
                el.click();
            });
            await page.waitForTimeout(2 * 1000);
            await page.waitForSelector(".settings-appearance__card");
            await page.$eval(".settings-appearance__card:nth-child(2) .relay-manage button", (el) => {
                el.click();
            });
            await page.waitForTimeout(1 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(0);
        },
        20 * 1000,
    );
});
