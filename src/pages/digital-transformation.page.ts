import { expect, type Locator, type Page } from '@playwright/test';

export class DigitalTransformationPage {
  constructor(private readonly page: Page) {}

  async gotoHome(): Promise<void> {
    await this.page.goto('/');
  }

  async gotoDigitalTransformationPage(): Promise<void> {
    await this.page.goto('/services/digital-transformation-consulting');
    await expect(this.page).toHaveURL(/\/services\/digital-transformation-consulting$/);
  }

  async openMainMenuIfVisible(): Promise<void> {
    const menuButton = this.page.getByRole('button', { name: /menu/i });
    if (await menuButton.isVisible().catch(() => false)) {
      const expanded = await menuButton.getAttribute('aria-expanded');
      if (expanded !== 'true') {
        await menuButton.click();
      }
    }
  }

  async openServicesMenu(): Promise<void> {
    const servicesButton = this.page.getByRole('button', { name: /^services$/i });
    if (await servicesButton.isVisible().catch(() => false)) {
      const expanded = await servicesButton.getAttribute('aria-expanded');
      if (expanded !== 'true') {
        await servicesButton.click();
      }
    }
  }

  async clickDigitalTransformationFromNavigation(): Promise<void> {
    await this.openMainMenuIfVisible();
    await this.openServicesMenu();
    await this.clickFirstVisible([
      this.page.locator('a[href="/services/digital-transformation-consulting"]'),
      this.page.getByRole('link', { name: /digital transformation/i }),
    ]);
  }

  async isServicesMenuVisible(): Promise<boolean> {
    await this.openMainMenuIfVisible();
    return this.isAnyVisible([
      this.page.getByRole('button', { name: /^services$/i }),
      this.page.getByRole('link', { name: /^services$/i }),
      this.page.getByRole('link', { name: /view all services/i }),
      this.page.locator('a[href="/services"]'),
    ]);
  }

  async isDigitalTransformationOptionVisibleInMenu(): Promise<boolean> {
    await this.openMainMenuIfVisible();
    await this.openServicesMenu();
    return this.isAnyVisible([
      this.page.locator('a[href="/services/digital-transformation-consulting"]'),
      this.page.getByRole('link', { name: /digital transformation/i }),
      this.page.getByRole('button', { name: /digital transformation/i }),
    ]);
  }

  async clickScheduleConsultationCta(): Promise<{ popupUrl?: string; currentUrl: string }> {
    return this.clickWithPopupFallback([
      this.page.getByRole('link', { name: /schedule a free consultation/i }),
      this.page.getByRole('button', { name: /schedule a free consultation/i }),
      this.page.locator('a[href*="calendar.app.google"], a[href*="calendly"], a[href*="hubspot"]'),
    ]);
  }

  async clickMaturityAssessmentCta(): Promise<{ popupUrl?: string; currentUrl: string }> {
    return this.clickWithPopupFallback([
      this.page.locator(
        'a[href*="digital-business-maturity-assessment"], a[href*="assessment"], a[href*="calendar"], a[href*="calendly"]',
      ),
      this.page.getByRole('link', { name: /complimentary assessment|request digital maturity assessment|schedule/i }),
      this.page.getByRole('button', { name: /complimentary assessment|request digital maturity assessment|schedule/i }),
    ]);
  }

  async getH1Text(): Promise<string> {
    const heading = this.page.getByRole('heading', { level: 1 });
    const count = await heading.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = heading.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        return (await candidate.textContent())?.trim() ?? '';
      }
    }
    return '';
  }

  async isIntroSummaryVisibleBelowH1(): Promise<boolean> {
    return this.page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (!h1) {
        return false;
      }

      let current = h1.nextElementSibling;
      while (current) {
        if (current.tagName.toLowerCase() === 'p') {
          const text = current.textContent?.trim() ?? '';
          return text.length > 0;
        }
        if (/^h[1-6]$/i.test(current.tagName)) {
          return false;
        }
        current = current.nextElementSibling;
      }
      return false;
    });
  }

  async isExplainerSectionVisible(): Promise<boolean> {
    return this.isAnyVisible([this.page.getByRole('heading', { name: /what is digital transformation\?/i })]);
  }

  async isMaturitySectionVisible(): Promise<boolean> {
    return this.isAnyVisible([this.page.getByRole('heading', { name: /digital maturity assessment/i })]);
  }

  async isMaturityAssessmentCtaVisible(): Promise<boolean> {
    return this.isAnyVisible([
      this.page.getByRole('link', { name: /request digital maturity assessment|schedule/i }),
      this.page.getByRole('button', { name: /request digital maturity assessment|schedule/i }),
      this.page.locator('a[href*="assessment"], a[href*="calendar"], a[href*="calendly"]'),
    ]);
  }

  async getServiceAgencySummaryVisible(): Promise<boolean> {
    const heading = this.page.getByRole('heading', { name: /your digital transformation agency/i });
    const count = await heading.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = heading.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        const parent = candidate.locator('..');
        const summary = parent.locator('p');
        const summaryCount = await summary.count();
        for (let j = 0; j < summaryCount; j += 1) {
          if (await summary.nth(j).isVisible().catch(() => false)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  async getPrimaryPillars(): Promise<string[]> {
    return this.page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h2')).find((node) =>
        /your digital transformation agency/i.test(node.textContent ?? ''),
      );
      const container = heading?.parentElement;
      if (!container) {
        return [];
      }

      return Array.from(container.querySelectorAll('li'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean);
    });
  }

  async getPrimaryPillarLayout(): Promise<Array<{ top: number; left: number }>> {
    return this.page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h2')).find((node) =>
        /your digital transformation agency/i.test(node.textContent ?? ''),
      );
      const container = heading?.parentElement;
      if (!container) {
        return [];
      }

      return Array.from(container.querySelectorAll('li'))
        .slice(0, 7)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, left: rect.left };
        });
    });
  }

  async hasPrimaryPillarDescriptions(): Promise<boolean> {
    return this.page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h2')).find((node) =>
        /your digital transformation agency/i.test(node.textContent ?? ''),
      );
      const container = heading?.parentElement;
      if (!container) {
        return false;
      }

      const items = Array.from(container.querySelectorAll('li'));
      return items.length === 7 && items.every((item) => (item.textContent?.trim().length ?? 0) >= 25);
    });
  }

  async hasHorizontalOverflow(): Promise<boolean> {
    return this.page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 1;
    });
  }

  async getMetadata(): Promise<{ title: string; description: string }> {
    return this.page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    }));
  }

  async getOpenGraphMetadata(): Promise<{ ogTitle: string; ogDescription: string; ogImage: string }> {
    return this.page.evaluate(() => ({
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
      ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
    }));
  }

  async isHeroImageVisible(): Promise<boolean> {
    const candidates = this.page.locator(
      'img[alt*="Business team" i], img[alt*="Hero" i], img[alt*="banner" i], main img',
    );
    const count = await candidates.count();
    for (let i = 0; i < count; i += 1) {
      if (await candidates.nth(i).isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  }

  async clickFirstVisible(locators: Locator[]): Promise<void> {
    for (const locator of locators) {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          await candidate.click();
          return;
        }
      }
    }
    throw new Error('No visible locator available for click action.');
  }

  private async isAnyVisible(locators: Locator[]): Promise<boolean> {
    for (const locator of locators) {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        if (await locator.nth(i).isVisible().catch(() => false)) {
          return true;
        }
      }
    }
    return false;
  }

  private async clickWithPopupFallback(
    locators: Locator[],
  ): Promise<{ popupUrl?: string; currentUrl: string }> {
    const popupPromise = this.page.waitForEvent('popup', { timeout: 3_000 }).catch(() => null);
    await this.clickFirstVisible(locators);
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState('domcontentloaded');
      return { popupUrl: popup.url(), currentUrl: this.page.url() };
    }

    await this.page.waitForLoadState('domcontentloaded');
    return { currentUrl: this.page.url() };
  }
}
