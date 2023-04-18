// import "expect-puppeteer";
import puppeteer, { Browser, Page } from "puppeteer";
import { PRIVATE_KEY } from "../data";
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
        "修改个人的信息",
        async () => {
            await page.waitForTimeout(4 * 1000);

            await page.waitForSelector(".sidebar__sticky button");
            await page.click(".sidebar__sticky button:nth-child(2)");
            await page.waitForSelector(".ReactModal__Content--after-open");

            const elementHandle = await page.$(".pw__content__wrapper .img-upload__wrapper input[type=file]");
            await elementHandle!.uploadFile("spec/test.png");
            await page.waitForTimeout(5 * 1000);
            await page.click(".profile-editor__info button");

            await page.waitForSelector(".profile-editor__form");

            const name = `我的新名字${new Date()}`;
            await page.$eval(".profile-editor__form input", async (el) => {
                el.value = "";
                el.focus();
            });

            await page.keyboard.sendCharacter(name);

            await page.$eval(".profile-editor__form button", (el) => {
                el.click();
            });
            await page.waitForTimeout(2 * 1000);

            // 查找是否房间名更新了
            await page.waitForSelector(".profile-editor__info h2");
            const resultName = await page.$eval(".profile-editor__info h2", (el) => {
                return el.innerText;
            });
            expect(resultName).toEqual(name);
        },
        900 * 1000,
    );
});
