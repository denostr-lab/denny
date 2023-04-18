// import "expect-puppeteer";
import puppeteer, { Browser, Page } from "puppeteer";
import { PRIVATE_KEY, PRIVATE_KEY2 } from "../data";
import { login, enterPublicRoom } from "../utils";
describe("测试双人私聊聊天场景", () => {
    let user1Browser: Browser;
    let user1Page: Page;
    let user2Browser: Browser;
    let user2Page: Page;
    beforeAll(async () => {
        user1Browser = await puppeteer.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        user1Page = await user1Browser.newPage();
        user2Browser = await puppeteer.launch({
            headless: false,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        user2Page = await user2Browser.newPage();

        // await page.goto("https://baidu.com");
    });
    afterAll(async () => {
        await user1Page.close();
        await user1Browser.close();
        await user2Page.close();
        await user2Browser.close();
    });

    it(
        "登录",
        async () => {
            await login(user1Page, PRIVATE_KEY);
            await login(user2Page, PRIVATE_KEY2);
        },
        30 * 1000,
    );

    it(
        "一起加入公共群聊",
        async () => {
            await enterPublicRoom(user1Page);
            await enterPublicRoom(user2Page);
        },
        20 * 1000,
    );
    it(
        "用户1找到用户2并且发送一条聊天信息",
        async () => {
            await enterPublicRoom(user1Page);
            await enterPublicRoom(user2Page);
        },
        20 * 1000,
    );
});
