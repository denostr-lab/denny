import { Browser, Page } from "puppeteer";

export interface PageAndBrowser {
    page: Page;
    browser: Browser;
}

export interface userInfo {
    name: string;
    pubkey: string;
}

export interface User {
    page: Page;
    browser: Browser;
    pubkey: string;
}
