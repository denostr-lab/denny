import { Browser, Page } from "puppeteer";
import { getPublicKey } from "nostr-tools";
import { PRIVATE_KEY, PRIVATE_KEY2 } from "../data";
import {
    login,
    logout,
    createBrowserAndPage,
    updateUserMeta,
    findMyUserMeta,
    openUserMetaInfo,
    findPrivateMessageRoomWithPubKey,
} from "../utils";
describe("test user meta operation", () => {
    let browser: Browser;
    let page: Page;
    let lastName: string;
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
        "change my profile",
        async () => {
            const name = `nostr awe user ${new Date()}`;
            lastName = name;
            await updateUserMeta(page, name);
            const resultName = await findMyUserMeta(page);
            expect(resultName).toEqual(name);
        },
        900 * 1000,
    );
    it(
        "logout and rescan my profile",
        async () => {
            await logout(page);
            await page.waitForTimeout(1 * 1000);
            await login(page, PRIVATE_KEY);
            await page.waitForTimeout(5 * 1000);
            await openUserMetaInfo(page);
            const resultName = await findMyUserMeta(page);
            expect(resultName).toEqual(lastName);
        },
        900 * 1000,
    );
    it(
        "other user confirm user meta",
        async () => {
            const result = await createBrowserAndPage();
            const browser = result.browser;
            const page = result.page;
            await login(page, PRIVATE_KEY2);
            const pubkey = getPublicKey(PRIVATE_KEY);
            const res = await findPrivateMessageRoomWithPubKey(page, pubkey, false);
            expect(res.name).toEqual(lastName);
            await browser.close();
        },
        900 * 1000,
    );
});
