import puppeteer, { Browser, Page } from "puppeteer";

export const sleep = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

export const createBrowserAndPage = async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    return { browser, page };
};
export const login = async (page: Page, key: string) => {
    await page.goto("http://localhost:8081/", { timeout: 90000 });
    await page.evaluate(() => {});
    await page.$eval('button[type="button"]', (el) => el.click());
    await page.waitForSelector("input[name='privatekey']");
    await page.focus("input[name='privatekey']");
    await page.keyboard.type(key);
    await page.keyboard.press("Enter");
};

export const privateChatFromRoom = (page: Page) => {
    // 从房间中
};
export const enterPublicRoom = async (page: Page, roomName: string = "房间1号") => {
    await page.waitForSelector(".header button");
    const header = await page.$(".header");
    await header?.$eval("button", (e) => {
        e.click();
    });
    await page.waitForSelector(".context-menu__item");
    await page.waitForTimeout(1 * 1000);

    await page.$$eval(".context-menu__item button", (el) => {
        el[1].click();
    });
    await page.waitForSelector(".public-rooms__input-wrapper");
    await page.waitForTimeout(3 * 1000);
    await page.$eval(".public-rooms__form button", (el) => {
        el.click();
    });
    // 随机加入一个房间
    await page.waitForSelector(".public-rooms__content button");
    await page.waitForTimeout(3 * 1000);

    await page.$eval(".public-rooms__content button", (el) => {
        el.click();
    });
    try {
        await page.$eval(".pw__content .header button", (el) => {
            el.click();
        });
    } catch (e) {}

    await page.waitForSelector(".room-selector__content");

    await page.$$eval(".room-selector__content", (el) => {
        el.map((i) => {
            if (i.querySelectorAll("p")[0].innerText === roomName) {
                i.click();
            }
        });
    });
};
