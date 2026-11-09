import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { SUPER_ADMIN } from './env';

test.describe.configure({ mode: 'serial' });

let page: Page;
let context: BrowserContext;
let totpSecret = '';
const snap = async (name: string) => {
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};
const nav = (name: string | RegExp) =>
  page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name, exact: typeof name === 'string' });

async function expectNoSeriousA11yViolations(p: Page) {
  const results = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map(
      (v) =>
        `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ') + ' [' + (n.any[0]?.message ?? '') + ']').join('; ')}`,
    ),
  ).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  // Reduced motion: no in-flight CSS transitions when axe samples colours (and exercises that path).
  context = await browser.newContext({ reducedMotion: 'reduce' });
  page = await context.newPage();
});
test.afterAll(async () => context.close());

test('unauthenticated visitors are sent to sign-in', async () => {
  await page.goto('/structure/faculties');
  await expect(page).toHaveURL(/\/login\?next=%2Fstructure%2Ffaculties/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await snap('01-login');
  await expectNoSeriousA11yViolations(page);
});

test('wrong password shows a generic error', async () => {
  await page.getByLabel('Email').fill(SUPER_ADMIN.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Invalid email or password' }),
  ).toBeVisible();
});

test('super admin signs in with email and password and lands where they were going', async () => {
  await page.getByLabel('Password').fill(SUPER_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/structure\/faculties$/);
  await expect(page.getByRole('heading', { name: 'Faculties' })).toBeVisible();
});

test('two-step verification can be turned on from Settings', async () => {
  await page.goto('/settings');
  await page
    .getByRole('button', { name: /Set up two-step verification|Enable/ })
    .first()
    .click();
  await expect(page.getByLabel('6-digit code')).toBeVisible();
  await snap('02-mfa-enrol');
  totpSecret = (await page.locator('code').first().textContent())!.trim();
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(totpSecret) }).generate();
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify and enable' }).click();
  const codes = page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  await snap('03-recovery-codes');
  await page.getByLabel('I have saved my recovery codes').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.goto('/structure/faculties');
});

test('creates an institution and switches to it', async () => {
  await nav('Institutions').click();
  await expect(page.getByRole('link', { name: /Yaba College of Technology/ })).toBeVisible();
  await page.getByRole('button', { name: 'New institution' }).click();
  const dialog = page.getByRole('dialog', { name: 'New institution' });
  await dialog.getByLabel('Full name').fill('Demo Polytechnic');
  await dialog.getByLabel('Short name').fill('DEMOPOLY');
  await expect(dialog.getByLabel('URL slug')).toHaveValue('demopoly');
  await dialog.getByRole('button', { name: 'Create institution' }).click();
  await expect(page.getByText('DEMOPOLY created')).toBeVisible();
  await expect(page.getByRole('link', { name: /Demo Polytechnic/ })).toBeVisible();

  await page
    .getByLabel('Institution', { exact: true })
    .selectOption({ label: 'DEMOPOLY · Demo Polytechnic' });
});

test('builds the academic structure: faculty → department → programme → level', async () => {
  // Faculty
  await nav('Faculties').click();
  await expect(page.getByText('DEMOPOLY · Academic structure')).toBeVisible();
  await page.getByRole('button', { name: 'New faculty' }).click();
  let dialog = page.getByRole('dialog', { name: 'New faculty' });
  await dialog.getByRole('button', { name: 'Create faculty' }).click();
  await expect(dialog.getByText('Required')).toBeVisible(); // client-side validation, plain language
  await dialog.getByLabel('Name').fill('School of Technology');
  await dialog.getByRole('button', { name: 'Create faculty' }).click();
  await expect(page.getByRole('cell', { name: 'School of Technology', exact: true })).toBeVisible();

  // Department
  await nav('Departments').click();
  await page.getByRole('button', { name: 'New department' }).click();
  dialog = page.getByRole('dialog', { name: 'New department' });
  await dialog.getByLabel('Faculty').selectOption({ label: 'School of Technology' });
  await dialog.getByLabel('Name').fill('Computer Science');
  await dialog.getByLabel('Code').fill('CSC');
  await dialog.getByRole('button', { name: 'Create department' }).click();
  await expect(page.getByRole('cell', { name: 'Computer Science', exact: true })).toBeVisible();

  // Duplicate department code → server-side conflict shown in the form
  await page.getByRole('button', { name: 'New department' }).click();
  dialog = page.getByRole('dialog', { name: 'New department' });
  await dialog.getByLabel('Faculty').selectOption({ label: 'School of Technology' });
  await dialog.getByLabel('Name').fill('Computing');
  await dialog.getByLabel('Code').fill('CSC');
  await dialog.getByRole('button', { name: 'Create department' }).click();
  await expect(dialog.getByText('duplicate')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Programme
  await nav('Programmes').click();
  await page.getByRole('button', { name: 'New programme' }).click();
  dialog = page.getByRole('dialog', { name: 'New programme' });
  await dialog.getByLabel('Department').selectOption({ label: 'Computer Science (CSC)' });
  await dialog.getByLabel('Name').fill('National Diploma in Computer Science');
  await dialog.getByLabel('Award').selectOption('ND');
  await dialog.getByLabel('Code').fill('ND-CS');
  await dialog.getByRole('button', { name: 'Create programme' }).click();
  await expect(
    page.getByRole('cell', { name: 'National Diploma in Computer Science', exact: true }),
  ).toBeVisible();

  // Level
  await nav('Academic Levels').click();
  await page.getByRole('button', { name: 'New level' }).click();
  dialog = page.getByRole('dialog', { name: 'New level' });
  await dialog.getByLabel('Name').fill('ND 1');
  await dialog.getByLabel('Code').fill('ND1');
  await dialog.getByRole('button', { name: 'Create level' }).click();
  await expect(page.getByRole('cell', { name: 'ND 1', exact: true })).toBeVisible();

  // Semester
  await nav('Semesters').click();
  await page.getByRole('button', { name: 'New semester' }).click();
  dialog = page.getByRole('dialog', { name: 'New semester' });
  await dialog.getByLabel('Name').fill('First Semester');
  await dialog.getByLabel('Code').fill('S1');
  await dialog.getByRole('button', { name: 'Create semester' }).click();
  await expect(page.getByRole('cell', { name: 'First Semester', exact: true })).toBeVisible();
  await nav('Programmes').click();
  await expect(
    page.getByRole('cell', { name: 'National Diploma in Computer Science', exact: true }),
  ).toBeVisible();
  await snap('05-programmes');
  await page.getByRole('button', { name: 'New programme' }).click();
  await snap('06-programme-dialog');
  await page
    .getByRole('dialog', { name: 'New programme' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await nav('Semesters').click();
  await expectNoSeriousA11yViolations(page);

  // Overview reflects the structure
  await nav('Overview').click();
  for (const [label, n] of [
    ['Faculties', '1'],
    ['Departments', '1'],
    ['Programmes', '1'],
    ['Academic levels', '1'],
    ['Semesters', '1'],
  ]) {
    await expect(page.getByRole('link', { name: `${label} ${n}` })).toBeVisible();
  }
  await snap('04-overview');
  // fresh load in dark mode
  await page.emulateMedia({ colorScheme: 'dark' });
  await snap('09-overview-dark');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Faculties 1' })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await snap('10-overview-dark-fresh');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectNoSeriousA11yViolations(page);
});

test('archives a faculty only after its departments are archived', async () => {
  await nav('Faculties').click();
  await page.getByRole('button', { name: 'Archive School of Technology' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText(/Archive or move this faculty/)).toBeVisible();
});

test('invites a content manager', async () => {
  await nav('Administrators').click();
  await page.getByRole('button', { name: 'Invite' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite administrator' });
  await dialog.getByLabel('Email').fill('new.cm@example.com');
  await dialog.getByLabel('Role').selectOption({ label: 'Content Manager' });
  await dialog.getByLabel('Institution').selectOption({ label: 'Demo Polytechnic' });
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Invitation sent to new.cm@example.com')).toBeVisible();
  const row = page.getByRole('row', { name: /new\.cm@example\.com/ });
  await expect(row.getByText('Invited')).toBeVisible();
  await expect(row.getByText('Content Manager · Demo Polytechnic')).toBeVisible();
  await snap('07-administrators');
  await expectNoSeriousA11yViolations(page);
});

/** Fictional sample outline for testing only; not an official course record. */
const SAMPLE_OUTLINE = `Course Content
Week 1: Introduction to Computer Science
1.1 Definition of computer science
1.2 Areas of computer science
Week 2: History of Computers
Week 3: Computer Generations
Week 4: Computer Hardware
ASSESSMENT
Continuous assessment 40%`;

test('creates a draft course flagged as demonstration data', async () => {
  await nav('Courses').click();
  await page.getByRole('link', { name: 'New course' }).first().click();
  await page
    .getByLabel('Programme')
    .selectOption({ label: 'National Diploma in Computer Science (ND) · Computer Science' });
  await page.getByLabel('Level').selectOption({ label: 'ND 1' });
  await page.getByLabel('Semester').selectOption({ label: 'First Semester' });
  await page.getByLabel('Course code').fill('COM 001');
  await page.getByLabel('Course title').fill('Introduction to Computer Science');
  await page.getByLabel('Credit units').fill('3');
  await page.getByRole('button', { name: 'Add objective' }).click();
  await page
    .getByRole('textbox', { name: 'Objective 1', exact: true })
    .fill('Describe the components of a computer system');
  await page.getByLabel('This is demonstration data (not an official course record)').check();
  await page.getByRole('button', { name: 'Create course' }).click();
  await expect(page).toHaveURL(/\/courses\/[a-f0-9]{24}\?tab=outline/);
  await expect(
    page.getByRole('heading', { name: 'Introduction to Computer Science' }),
  ).toBeVisible();
  await expect(
    page.getByText('Demonstration data: this is not an official course record.'),
  ).toBeVisible();
  await snap('11-course-new');
});

test('pastes an outline, reviews the detected topics, approves it and syncs topics', async () => {
  await page.getByRole('button', { name: 'Add outline' }).click();
  const dialog = page.getByRole('dialog', { name: 'New outline version' });
  await dialog.getByRole('radio', { name: 'Paste text' }).click();
  await dialog.getByLabel('Outline text').fill(SAMPLE_OUTLINE);
  await dialog.getByRole('button', { name: 'Analyse text' }).click();

  await expect(page.getByLabel('Topic 1 title')).toHaveValue('Introduction to Computer Science');
  await expect(page.getByLabel('Topic 3 title')).toHaveValue('Computer Generations');
  await expect(page.getByLabel('Subtopic 1.2 title')).toHaveValue('Areas of computer science');
  await expect(page.getByText(/Skipped “ASSESSMENT”/)).toBeVisible();
  await expect(page.getByText('Detected from document layout')).toBeVisible();
  await snap('12-outline-review');
  await expectNoSeriousA11yViolations(page);

  // reviewer correction before approval
  await page.getByLabel('Topic 4 title').fill('Computer Hardware Components');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Outline saved')).toBeVisible();

  await page.getByRole('button', { name: 'Approve outline' }).click();
  await page
    .getByRole('dialog', { name: /Approve version 1/ })
    .getByRole('button', { name: 'Approve outline' })
    .click();
  await expect(page.getByText('Active for this course')).toBeVisible();
  await expect(page.getByLabel('Topic 1 title')).toBeDisabled();

  await page.getByRole('button', { name: 'Sync topics…' }).click();
  const sync = page.getByRole('dialog', { name: 'Sync topics from the outline' });
  await expect(
    sync.getByText('Introduction to Computer Science › Areas of computer science'),
  ).toBeVisible();
  await sync.getByRole('button', { name: 'Create 6 topics' }).click();
  await expect(page.getByText('6 topics created')).toBeVisible();
});

test('reorders topics with the accessible move controls', async () => {
  await page.getByRole('tab', { name: /Topics/ }).click();
  const topics = page.getByRole('list', { name: 'Topics' }).locator(':scope > li');
  await expect(topics).toHaveCount(4);
  await page.getByRole('button', { name: 'Move Computer Generations up' }).click();
  await expect(topics.nth(1)).toContainText('Computer Generations');
  await expect(topics.nth(2)).toContainText('History of Computers');
  await expect(topics.nth(0)).toContainText('Areas of computer science');
  await snap('13-topics');
  await expectNoSeriousA11yViolations(page);
});

test('uploads a source document and inspects its processed passages', async () => {
  await page.getByRole('tab', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'Upload' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload source material' });
  await dialog.getByLabel('File').setInputFiles({
    name: 'hardware-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Computer hardware includes the CPU, memory and storage devices. '.repeat(80),
    ),
  });
  await expect(dialog.getByLabel('Title')).toHaveValue('hardware-notes');
  await expect(dialog.getByRole('button', { name: 'Upload' })).toBeDisabled(); // licence not confirmed yet
  await dialog
    .getByLabel('I confirm the institution has the right to use this material for teaching.')
    .check();
  await dialog.getByRole('button', { name: 'Upload' }).click();
  const row = page.getByRole('row', { name: /hardware-notes/ });
  await expect(row.getByText('Ready')).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: /hardware-notes/ }).click();
  const detail = page.getByRole('dialog', { name: 'hardware-notes' });
  await expect(detail.getByText('Extracted passages')).toBeVisible();
  await expect(detail.getByText(/Embeddings were skipped/)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Approve for AI generation' })).toBeVisible();
  await snap('14-source-detail');
  await detail.getByRole('button', { name: 'Close' }).click();
});

test('generates notes in the AI Content Studio, edits them with autosave and submits for review', async () => {
  // A reviewer approves the uploaded source so it can ground generation.
  await page
    .getByRole('row', { name: /hardware-notes/ })
    .getByRole('button', { name: /hardware-notes/ })
    .click();
  await page
    .getByRole('dialog', { name: 'hardware-notes' })
    .getByRole('button', { name: 'Approve for AI generation' })
    .click();
  await expect(page.getByText('Approved for AI generation').first()).toBeVisible();
  await page
    .getByRole('dialog', { name: 'hardware-notes' })
    .getByRole('button', { name: 'Close' })
    .click();

  await nav('AI Content Studio').click();
  await expect(page.getByRole('heading', { name: 'AI Content Studio' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Course', exact: true })
    .selectOption({ label: 'COM 001 · Introduction to Computer Science' });
  await page.getByLabel(/Computer Hardware Components/).check();
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText('Draft ready for review')).toBeVisible({ timeout: 20_000 });
  await snap('15-studio');
  await page.getByRole('link', { name: 'Open' }).click();

  await expect(
    page.getByText(/Development placeholder: produced without an AI model/),
  ).toBeVisible();
  const sources = page.getByRole('region').filter({ hasText: 'Sources cited' });
  await expect(page.getByText('hardware-notes').first()).toBeVisible();
  const editor = page.getByRole('textbox', {
    name: 'Comprehensive notes for Computer Hardware Components',
  });
  await expect(
    editor.getByRole('heading', { name: /Introduction to Computer Hardware Components/ }),
  ).toBeVisible();
  await editor.getByText(/summarise Computer Hardware Components here/).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); // end of document
  await page.keyboard.type(' Reviewed by the lecturer.');
  await expect(editor.getByText(/here\. Reviewed by the lecturer\./)).toBeVisible();
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
  // AI assist: suggestion only, applied when accepted.
  await editor.getByText('Reviewed by the lecturer.').selectText();
  await page.getByRole('button', { name: 'AI assist' }).click();
  const assist = page.getByRole('dialog', { name: 'AI assist' });
  await assist.getByRole('button', { name: 'Simplify' }).click();
  await expect(assist.getByText(/\[Development placeholder: simplify\]/)).toBeVisible();
  await assist.getByRole('button', { name: 'Replace selection' }).click();
  await expect(editor.getByText(/\[Development placeholder: simplify\]/)).toBeVisible();
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 10_000 });
  await snap('16-version-editor');
  await expectNoSeriousA11yViolations(page);
  void sources;

  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Submitted for review')).toBeVisible();
  await expect(page.getByText('Locked')).toBeVisible();
  // Separation of duties: the author is told someone else must review, and gets no Review button.
  await expect(page.getByText('another reviewer must review it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);

  await nav('Content Reviews').click();
  await expect(page.getByRole('link', { name: /Computer Hardware Components/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('quiz management and AI usage pages are available', async () => {
  await nav('Quiz Management').click();
  await expect(page.getByRole('heading', { name: 'Quiz management' })).toBeVisible();
  await expect(page.getByText('No questions here')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await nav('AI Usage & Costs').click();
  await expect(page.getByRole('heading', { name: 'AI usage & costs' })).toBeVisible();
  await expect(page.getByText('AI calls')).toBeVisible();
  await snap('17-ai-usage');
  await expectNoSeriousA11yViolations(page);
});

test('publishes a course and previews content as a student', async () => {
  await nav('Content Reviews').click();
  await page.getByRole('link', { name: /Computer Hardware Components/ }).click();
  await page.getByRole('button', { name: 'Preview as student' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview as student' });
  await expect(
    preview.getByText(/prepared with AI assistance and reviewed by staff/),
  ).toBeVisible();
  await expect(
    preview.getByRole('heading', { name: /Introduction to Computer Hardware Components/ }),
  ).toBeVisible();
  await snap('18-student-preview');
  await preview.getByRole('button', { name: 'Close' }).click();

  await nav('Courses').click();
  await page
    .getByRole('link', { name: /Introduction to Computer Science/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Publish course' }).click();
  await expect(page.getByText('Course published')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unpublish course' })).toBeVisible();

  await nav('Publishing Centre').click();
  await expect(page.getByRole('heading', { name: 'Publishing centre' })).toBeVisible();
  await expect(page.getByText('Nothing is waiting. Approved content appears here.')).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('main').getByText('Course published')).toBeVisible(); // the history entry, not the toast
  await expect(
    page.getByRole('main').getByText('COM 001 Introduction to Computer Science'),
  ).toBeVisible();
  await snap('19-publishing-history');
  await expectNoSeriousA11yViolations(page);
});

test('a self-registered student appears in Students and can be suspended', async () => {
  const r = await page.request.post('/api/v1/auth/register', {
    data: {
      email: 'learner@e2e.test',
      password: 'learner-pass-1',
      firstName: 'Ada',
      lastName: 'Learner',
      institutionSlug: 'demopoly',
    },
  });
  expect(r.status()).toBe(202);
  await nav('Students').click();
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
  const row = page.getByRole('row', { name: /learner@e2e\.test/ });
  await expect(row.getByLabel('Email not verified')).toBeVisible();
  await snap('20-students');
  await expectNoSeriousA11yViolations(page);
  await row.getByRole('button', { name: 'Suspend' }).click();
  await page
    .getByRole('dialog', { name: 'Suspend student?' })
    .getByRole('button', { name: 'Suspend' })
    .click();
  await expect(page.getByText('Student suspended')).toBeVisible();
  await expect(row.getByText('Suspended')).toBeVisible();
  await row.getByRole('button', { name: 'Reactivate' }).click();
  await page
    .getByRole('dialog', { name: 'Reactivate student?' })
    .getByRole('button', { name: 'Reactivate' })
    .click();
  await expect(page.getByText('Student reactivated')).toBeVisible();
});

test('analytics and the overview show live metrics', async () => {
  await nav('Analytics').click();
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByText('Active learners')).toBeVisible();
  await expect(page.getByText('No student activity yet')).toBeVisible();
  await snap('21-analytics');
  await expectNoSeriousA11yViolations(page);
  await nav('Overview').click();
  await expect(page.getByText('Registered students')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await snap('22-overview');
  await expectNoSeriousA11yViolations(page);
});

test('later-phase sections explain when they arrive', async () => {
  await nav(/AI Video Studio/).click();
  await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
});

test('navigation works on a phone-sized screen', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await snap('08-mobile-nav');
  await nav('Semesters').click();
  await expect(page.getByRole('heading', { name: 'Semesters' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('signing out ends the session', async () => {
  await page.getByRole('button', { name: /Super/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('forgot-password never reveals whether an account exists', async () => {
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill('nobody@e2e.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/If an account exists for that email/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('second sign-in asks for the authenticator code', async () => {
  await page.getByLabel('Email').fill(SUPER_ADMIN.email);
  await page.getByLabel('Password').fill(SUPER_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  // next time-step, since the enrolment code was already used (replay protection)
  const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(totpSecret) }).generate({
    timestamp: Date.now() + 30_000,
  });
  await page.getByLabel('Authentication code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
});
