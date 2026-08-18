import net from 'node:net';
import tls from 'node:tls';

// A small SMTP client. The service has no other dependencies, and a welcome
// email needs only AUTH LOGIN over STARTTLS, so this stays in the repo rather
// than pulling in a mail library.

const readReply = (socket) =>
  new Promise((resolve, reject) => {
    let buffer = '';

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      // A reply ends with "NNN " (space, not hyphen) on the final line.
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;

      cleanup();
      const code = Number(last.slice(0, 3));
      if (code >= 400) reject(new Error(`SMTP ${code}: ${last.slice(4)}`));
      else resolve({ code, text: buffer });
    };

    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('SMTP connection closed early')); };

    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });

const say = async (socket, line) => {
  socket.write(line + '\r\n');
  return readReply(socket);
};

const encodeHeader = (value) =>
  // Any non-ASCII in a header has to be encoded or the client shows mojibake.
  /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const wrapBase64 = (text) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

export const sendMail = async ({
  host, port = 587, user, password,
  from, fromName, to, bcc = [], subject, html, text,
  timeoutMs = 25_000,
}) => {
  const socket = net.createConnection({ host, port });
  socket.setTimeout(timeoutMs);
  socket.on('timeout', () => socket.destroy(new Error('SMTP timeout')));

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  await readReply(socket);
  await say(socket, 'EHLO elivate-intake');
  await say(socket, 'STARTTLS');

  const secure = tls.connect({ socket, servername: host });
  secure.setTimeout(timeoutMs);
  secure.on('timeout', () => secure.destroy(new Error('SMTP timeout')));
  await new Promise((resolve, reject) => {
    secure.once('secureConnect', resolve);
    secure.once('error', reject);
  });

  try {
    await say(secure, 'EHLO elivate-intake');
    await say(secure, 'AUTH LOGIN');
    await say(secure, Buffer.from(user, 'utf8').toString('base64'));
    await say(secure, Buffer.from(password, 'utf8').toString('base64'));

    await say(secure, `MAIL FROM:<${from}>`);
    const recipients = [to, ...bcc].filter(Boolean);
    for (const recipient of recipients) {
      await say(secure, `RCPT TO:<${recipient}>`);
    }

    await say(secure, 'DATA');

    const boundary = `elv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const headers = [
      `From: ${encodeHeader(fromName)} <${from}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `Date: ${new Date().toUTCString()}`,
    ].join('\r\n');

    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(text),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(html),
      `--${boundary}--`,
    ].join('\r\n');

    // A lone "." would end the message early, so it is escaped per RFC 5321.
    const message = `${headers}\r\n\r\n${body}`.replace(/\r?\n\./g, '\r\n..');
    secure.write(`${message}\r\n.\r\n`);
    await readReply(secure);

    await say(secure, 'QUIT').catch(() => {});
  } finally {
    secure.destroy();
    socket.destroy();
  }
};
