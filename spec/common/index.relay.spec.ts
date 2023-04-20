// import "expect-puppeteer";
import puppeteer, { Browser, Page } from "puppeteer";
import { PRIVATE_KEY } from "../data";
import { clearInterval } from "timers";
let relayUrl = "wss://nostr.paiyaapp.com";
describe("测试公共功能", () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
        browser = await puppeteer.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        page = await browser.newPage();

        // await page.goto("https://baidu.com");
    });
    afterAll(async () => {
        await page.close();
        await browser.close();
    });

    it(
        "登录",
        async () => {
            await page.goto("http://localhost:8081/", { timeout: 90000 });
            await page.evaluate(() => {});
            await page.$eval('button[type="button"]', (el) => el.click());
            await page.waitForSelector("input[name='privatekey']");
            await page.focus("input[name='privatekey']");
            await page.keyboard.type(PRIVATE_KEY);
            await page.keyboard.press("Enter");
        },
        30 * 1000,
    );
    it(
        "进入页面后的中继情况",
        async () => {
            await page.waitForSelector(".relay-signal");
            await page.waitForTimeout(5 * 1000);

            let relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(1);
        },
        20 * 1000,
    );
    it(
        "取消当前的节点连接",
        async () => {
            await page.click(".relay-signal");
            await page.waitForTimeout(2 * 1000);
            await page.waitForSelector(".settings-appearance__card");
            // 取消当前的节点连接
            await page.click(".settings-appearance__card:nth-child(2) .toggle-margin button");
            await page.waitForTimeout(1 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(0);
        },
        20 * 1000,
    );
    it(
        "恢复中继连接",
        async () => {
            await page.waitForSelector(".relay-signal");
            await page.click(".settings-appearance__card:nth-child(2) .toggle-margin button");
            await page.waitForTimeout(1 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            // expect(parseInt(relayConnectCount)).toEqual(1);
        },
        20 * 1000,
    );
    it(
        "添加新的中继",
        async () => {
            await page.waitForSelector(".relay-signal");
            await page.$eval(".settings-window__cards-wrapper .keyword-notification__keyword input", async (el) => {
                el.focus();
            });
            await page.keyboard.type(relayUrl);
            await page.click(".settings-window__cards-wrapper .keyword-notification__keyword button");
            await page.waitForTimeout(5 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(2);
        },
        20 * 1000,
    );
    it(
        "保存中继",
        async () => {
            await page.click(".settings-window__cards-wrapper .keyword-notification__keyword .relay-buttons button");
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
        "重置中继",
        async () => {
            await page.click(
                ".settings-window__cards-wrapper .keyword-notification__keyword .relay-buttons button:nth-child(2)",
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
        "删除中继",
        async () => {
            await page.click(".relay-signal");
            await page.waitForTimeout(2 * 1000);
            await page.waitForSelector(".settings-appearance__card");
            await page.click(".settings-appearance__card:nth-child(2) .relay-manage button");
            await page.waitForTimeout(1 * 1000);
            const relayConnectCount = await page.$eval(".relay-signal small", async (el) => {
                return el.innerText;
            });
            expect(parseInt(relayConnectCount)).toEqual(0);
        },
        20 * 1000,
    );
});
