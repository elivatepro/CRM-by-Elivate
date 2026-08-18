// Email clients strip modern CSS, so these templates use table layout and
// inline styles only. Everything renders on the Elivate Network dark theme,
// with a light-ink fallback for clients that ignore background colours.

const BRAND = '#CBE236';
const BRAND_PALE = '#F9FFD3';
const GROUND = '#0F0F0D';
const SURFACE = '#17180F';
const INK = '#F2F0E6';
const INK_SOFT = '#A8AC96';
const INK_FAINT = '#7C806E';
const LINE = '#2C2E1F';

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// One shell so both emails share the same frame.
const shell = ({ preheader, markUrl, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<title>Elivate Network</title>
</head>
<body style="margin:0;padding:0;background:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${GROUND};padding:28px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:${SURFACE};border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
        <tr>
          <td align="center" style="padding:34px 28px 6px;">
            <img src="${markUrl}" width="64" height="64" alt="Elivate Network"
                 style="display:block;border:0;width:64px;height:auto;" />
            <div style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:2px;
                        text-transform:uppercase;color:${INK_FAINT};padding-top:14px;">
              Elivate Network
            </div>
          </td>
        </tr>
        ${body}
        <tr>
          <td style="padding:22px 28px 30px;border-top:1px solid ${LINE};">
            <div style="font-family:${FONT};font-size:12px;line-height:1.6;color:${INK_FAINT};text-align:center;">
              You are receiving this because you registered with Elivate Network.
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

const heading = (text) =>
  `<tr><td style="padding:6px 28px 0;">
     <h1 style="margin:0;font-family:${FONT};font-size:25px;line-height:1.25;font-weight:700;color:${INK};text-align:center;">
       ${escape(text)}</h1>
   </td></tr>`;

const paragraph = (html, top = 16) =>
  `<tr><td style="padding:${top}px 28px 0;">
     <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK_SOFT};">${html}</p>
   </td></tr>`;

const strong = (text) => `<strong style="color:${INK};font-weight:600;">${escape(text)}</strong>`;

const link = (href, text) =>
  `<a href="${escape(href)}" style="color:${BRAND};text-decoration:underline;word-break:break-word;">${escape(text ?? href)}</a>`;

// ---------------------------------------------------------------------------
// 1. Application received — sent as soon as the form is submitted.

export const applicationReceived = ({ firstName, markUrl }) => {
  const subject = 'We have received your application — Elivate Network';

  const html = shell({
    preheader: 'Your application is in. We will be in touch once it has been reviewed.',
    markUrl,
    body: [
      heading('Application received'),
      paragraph(`Hi ${escape(firstName)},`, 22),
      paragraph(
        `Thank you for registering with ${strong('Elivate Network')}. Your application has been received and is now with the team for review.`,
      ),
      paragraph(
        'You do not need to do anything yet. Once your application has been approved you will get a second email with your member ID and the steps to get started.',
      ),
      paragraph('Keep an eye on your inbox, including your spam folder.'),
      paragraph(`— ${strong('The Elivate Network Team')}`, 22),
      `<tr><td style="height:8px;"></td></tr>`,
    ].join(''),
  });

  const text = `Application received

Hi ${firstName},

Thank you for registering with Elivate Network. Your application has been
received and is now with the team for review.

You do not need to do anything yet. Once your application has been approved
you will get a second email with your member ID and the steps to get started.

Keep an eye on your inbox, including your spam folder.

- The Elivate Network Team`;

  return { subject, html, text };
};

// ---------------------------------------------------------------------------
// 2. Welcome — sent when a member is approved.

const TRAINER_IOS = 'https://apps.apple.com/app/trainercentral-learner/id1582771661';
const TRAINER_ANDROID = 'https://play.google.com/store/apps/details?id=com.zohocorp.trainercentral';
const ACADEMY_URL = 'https://elivatenetwork.trainercentralsite.com';
const COURSE_URL = 'https://elivatenetwork.trainercentralsite.com/course/network-varsity';
const WHATSAPP_URL = 'https://chat.whatsapp.com/KG37AV69UpxIO0fMhSyiJs?mode=gi_t';
const MEET_IOS = 'https://apps.apple.com/app/google-meet/id1096918571';
const MEET_ANDROID = 'https://play.google.com/store/apps/details?id=com.google.android.apps.meetings';

const stepBlock = (number, title, inner) => `
<tr><td style="padding:26px 28px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${GROUND};border:1px solid ${LINE};border-radius:10px;">
    <tr>
      <td style="padding:18px 20px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="26" style="vertical-align:top;">
              <div style="width:22px;height:22px;border-radius:11px;background:${BRAND};
                          font-family:${FONT};font-size:12px;font-weight:700;color:${GROUND};
                          text-align:center;line-height:22px;">${number}</div>
            </td>
            <td style="padding-left:10px;font-family:${FONT};font-size:16px;font-weight:650;color:${INK};line-height:22px;">
              ${escape(title)}
            </td>
          </tr>
        </table>
        ${inner}
      </td>
    </tr>
  </table>
</td></tr>`;

const stepText = (html, top = 12) =>
  `<p style="margin:${top}px 0 0;font-family:${FONT};font-size:14px;line-height:1.65;color:${INK_SOFT};">${html}</p>`;

export const welcome = ({ firstName, memberId, markUrl }) => {
  const subject = 'You’re In — Welcome to Elivate Network';

  const idBlock = `
<tr><td style="padding:24px 28px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${GROUND};border:1px solid ${BRAND};border-radius:12px;">
    <tr><td align="center" style="padding:20px 18px 22px;">
      <div style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.6px;
                  text-transform:uppercase;color:${INK_FAINT};">Your member ID</div>
      <div style="font-family:${FONT};font-size:32px;font-weight:700;letter-spacing:2px;
                  color:${BRAND_PALE};padding-top:8px;">${escape(memberId)}</div>
      <div style="font-family:${FONT};font-size:13px;line-height:1.55;color:${INK_SOFT};padding-top:10px;">
        Save this. You will need it every time you submit a monthly order.
      </div>
    </td></tr>
  </table>
</td></tr>`;

  const html = shell({
    preheader: `Welcome to Elivate Network. Your member ID is ${memberId}.`,
    markUrl,
    body: [
      heading('You’re in'),
      paragraph(`Hi ${escape(firstName)},`, 22),
      paragraph(`You are officially part of ${strong('Elivate Network')}.`),
      paragraph(
        'Your registration has been completed successfully, and this marks the beginning of your journey with the community.',
      ),
      paragraph(
        `Elivate Network gives you a structured place to ${strong('learn, connect, grow, and take action')}.`,
      ),
      idBlock,
      paragraph(`To get started, complete these ${strong('3 steps in order')}:`, 26),

      stepBlock(
        1,
        'Download and access our LMS',
        [
          stepText('Our Learning Management System is where you will access your training and learning resources.'),
          stepText(`${strong('Step 1:')} Download TrainerCentral: ${link(TRAINER_IOS, 'iPhone')} &nbsp;·&nbsp; ${link(TRAINER_ANDROID, 'Android')}`),
          stepText(`${strong('Step 2:')} Open TrainerCentral and enter this Academy URL:<br />${link(ACADEMY_URL)}`),
          stepText(`${strong('Step 3:')} Sign up and begin with the ${strong('Network Varsity Training')}.`),
          stepText(`You can also open the course directly: ${link(COURSE_URL, 'Network Varsity')}`),
        ].join(''),
      ),

      stepBlock(
        2,
        'Join our WhatsApp community',
        [
          stepText('Connect with other members and receive important updates, announcements, and information about upcoming activities.'),
          stepText(link(WHATSAPP_URL, 'Join the community')),
        ].join(''),
      ),

      stepBlock(
        3,
        'Download Google Meet',
        [
          stepText('We occasionally use Google Meet to stream live trainings, meetings, and events. Install it so you are ready whenever a live session is announced.'),
          stepText(`${link(MEET_IOS, 'iPhone')} &nbsp;·&nbsp; ${link(MEET_ANDROID, 'Android')}`),
        ].join(''),
      ),

      paragraph('You do not need to figure everything out at once.', 26),
      paragraph(
        `Start with the ${strong('Network Varsity Training')}, understand the system, connect with the community, and build from there.`,
      ),
      paragraph(`Welcome to ${strong('Elivate Network')}.`),
      paragraph(`— ${strong('The Elivate Network Team')}`, 22),
      `<tr><td style="height:8px;"></td></tr>`,
    ].join(''),
  });

  const text = `You're In - Welcome to Elivate Network

Hi ${firstName},

You are officially part of Elivate Network.

Your registration has been completed successfully, and this marks the
beginning of your journey with the community.

Elivate Network gives you a structured place to learn, connect, grow,
and take action.

YOUR MEMBER ID: ${memberId}
Save this. You will need it every time you submit a monthly order.

To get started, complete these 3 steps in order:

1. DOWNLOAD AND ACCESS OUR LMS
   Our Learning Management System is where you will access your training
   and learning resources.

   Step 1: Download TrainerCentral
     iPhone:  ${TRAINER_IOS}
     Android: ${TRAINER_ANDROID}

   Step 2: Open TrainerCentral and enter this Academy URL:
     ${ACADEMY_URL}

   Step 3: Sign up and begin with the Network Varsity Training.
     Course link: ${COURSE_URL}

2. JOIN OUR WHATSAPP COMMUNITY
   Connect with other members and receive important updates, announcements,
   and information about upcoming activities.
     ${WHATSAPP_URL}

3. DOWNLOAD GOOGLE MEET
   We occasionally use Google Meet to stream live trainings, meetings and
   events. Install it so you are ready whenever a live session is announced.
     iPhone:  ${MEET_IOS}
     Android: ${MEET_ANDROID}

You do not need to figure everything out at once.

Start with the Network Varsity Training, understand the system, connect
with the community, and build from there.

Welcome to Elivate Network.

- The Elivate Network Team`;

  return { subject, html, text };
};

// ---------------------------------------------------------------------------
// 3. Member ID only — for members who registered before these emails existed.

export const memberIdOnly = ({ firstName, memberId, markUrl }) => {
  const subject = `Your Elivate Network member ID: ${memberId}`;

  const idBlock = `
<tr><td style="padding:24px 28px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${GROUND};border:1px solid ${BRAND};border-radius:12px;">
    <tr><td align="center" style="padding:20px 18px 22px;">
      <div style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.6px;
                  text-transform:uppercase;color:${INK_FAINT};">Your member ID</div>
      <div style="font-family:${FONT};font-size:32px;font-weight:700;letter-spacing:2px;
                  color:${BRAND_PALE};padding-top:8px;">${escape(memberId)}</div>
    </td></tr>
  </table>
</td></tr>`;

  const html = shell({
    preheader: `Your Elivate Network member ID is ${memberId}. Save it for monthly orders.`,
    markUrl,
    body: [
      heading('Your member ID'),
      paragraph(`Hi ${escape(firstName)},`, 22),
      paragraph(
        `You are a registered member of ${strong('Elivate Network')}. Every member now has a member ID, and this one is yours.`,
      ),
      idBlock,
      paragraph(
        `Please save it. You will be asked for it each month when you submit your order for pickup.`,
        22,
      ),
      paragraph(`— ${strong('The Elivate Network Team')}`, 22),
      `<tr><td style="height:8px;"></td></tr>`,
    ].join(''),
  });

  const text = `Your Elivate Network member ID

Hi ${firstName},

You are a registered member of Elivate Network. Every member now has a
member ID, and this one is yours.

YOUR MEMBER ID: ${memberId}

Please save it. You will be asked for it each month when you submit your
order for pickup.

- The Elivate Network Team`;

  return { subject, html, text };
};
