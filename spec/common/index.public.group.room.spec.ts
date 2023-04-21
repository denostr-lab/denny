import { Browser, Page } from "puppeteer";
import { PRIVATE_KEY } from "../data";
import { login, createBrowserAndPage, createGroupChat, updateGroupChatMeta } from "../utils";
describe("test public group change roon metadata", () => {
    let browser: Browser;
    let page: Page;
    beforeAll(async () => {
        const result = await createBrowserAndPage();
        browser = result.browser;
        page = result.page;
        await login(page, PRIVATE_KEY);
    });
    afterAll(async () => {
        await browser.close();
    });
    it(
        "create public group room",
        async () => {
            const roomName = `public room ${new Date().toISOString()}`;
            await createGroupChat(page, roomName);
        },
        900 * 1000,
    );
    it(
        "update public room meta",
        async () => {
            const roomName = `public new room name ${new Date().toISOString()}`;
            await updateGroupChatMeta(page, roomName);
        },
        9000 * 1000,
    );
});
