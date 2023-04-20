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

            // await page.$eval("input[type='privatekey']", (el) => (el.value = PRIVATE_KEY));

            await page.keyboard.press("Enter");
        },
        30 * 1000,
    );
    it(
        "创建私密群聊房间",
        async () => {
            await page.waitForSelector(".header button");
            const header = await page.$(".header");
            await header?.$eval("button", (e) => {
                e.click();
            });
            await page.waitForSelector(".context-menu__item");

            await page.$eval(".context-menu__item button", (el) => {
                el.click();
            });
            await page.waitForSelector(".ReactModal__Content--after-open");

            await page.$eval(".ReactModal__Content--after-open textarea", async (el) => {
                el.focus();
            });
            await page.$eval(".ReactModal__Content--after-open .setting-tile__options button", async (el) => {
                el.click();
            });
            await page.waitForSelector(".tippy-content");

            await page.$$eval(".tippy-content button", async (el) => {
                el.forEach((element) => {
                    if (element.innerText === "Private (invite only)") {
                        element.click();
                    }
                });
            });
            const name = `私密房间${new Date()}`;
            await page.keyboard.type(name);

            await page.$eval(".ReactModal__Content--after-open input", async (el) => {
                el.focus();
            });
            await page.keyboard.type(name);

            await page.$eval(".create-room__name-wrapper button", (el) => {
                el.click();
            });
            await page.waitForTimeout(5 * 1000);

            // 查找是否有创建的房间
            await page.waitForSelector(".room-selector__content");

            await page.$$eval(
                ".room-selector__content",
                (el, name) => {
                    el.map((i) => {
                        const innerText =
                            i.querySelectorAll("p")?.[1]?.innerText || i.querySelectorAll("p")?.[0]?.innerText;
                        if (innerText === name) {
                            i.click();
                        }
                    });
                },
                name,
            );
            const resultName = await page.$$eval(
                ".room-selector__content",
                (el, name) => {
                    let result = "";
                    el.map((i) => {
                        const innerText =
                            i.querySelectorAll("p")?.[1]?.innerText || i.querySelectorAll("p")?.[0]?.innerText;
                        if (innerText === name) {
                            result = name;
                        }
                    });

                    return result;
                },
                name,
            );

            expect(resultName).toEqual(name);

            await page.waitForSelector(".room-input__input-container");

            await page.waitForTimeout(2 * 1000);
        },
        900 * 1000,
    );
    it(
        "修改已经创建的房间的信息",
        async () => {
            await page.waitForSelector(".room-header__btn");
            await page.click(".room-header__btn");
            await page.waitForSelector(".room-profile__display");

            const elementHandle = await page.$(".img-upload__wrapper input[type=file]");
            await elementHandle!.uploadFile("spec/test.png");
            await page.waitForTimeout(5 * 1000);
            await page.click(".room-profile__display button");

            await page.waitForSelector(".room-profile__edit-form");

            const name = `私密新房间名${new Date()}`;
            await page.$eval(".room-profile__edit-form input", async (el) => {
                el.value = "";
                el.focus();
            });

            await page.keyboard.sendCharacter(name);

            await page.$eval(".room-profile__edit-form textarea", async (el) => {
                el.value = "";
                el.focus();
            });
            await page.keyboard.sendCharacter(name);

            await page.$eval(".room-profile__edit-form button", (el) => {
                el.click();
            });
            await page.waitForTimeout(10 * 1000);

            // 查找是否房间名更新了
            await page.waitForSelector(".room-selector__content");
            let resultName = await page.$$eval(
                ".room-selector__content",
                (el, name) => {
                    let result = "";
                    el.map((i) => {
                        const innerText =
                            i.querySelectorAll("p")?.[1]?.innerText || i.querySelectorAll("p")?.[0]?.innerText;
                        if (innerText === name) {
                            result = name;
                        }
                    });
                    return result;
                },
                name,
            );

            expect(resultName).toEqual(name);
            // 刷新验证
            await page.reload();
            // 查找是否房间名更新了
            await page.waitForSelector(".room-selector__content");
            await page.waitForTimeout(10 * 1000);

            resultName = await page.$$eval(
                ".room-selector__content",
                (el, name) => {
                    let result = "";
                    el.map((i) => {
                        const innerText =
                            i.querySelectorAll("p")?.[1]?.innerText || i.querySelectorAll("p")?.[0]?.innerText;
                        if (innerText === name) {
                            result = name;
                        }
                    });
                    return result;
                },
                name,
            );
            expect(resultName).toEqual(name);
        },
        9000 * 1000,
    );
});
