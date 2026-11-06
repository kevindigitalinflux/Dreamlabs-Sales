/** Anonymised nested Gmail-style DSN. All identities are local fixture data. */
export function bounceMimeFixture({structured=false, failedHeader=true, returned=true, sentence=true, status='5.2.1', recipient='person@example.com', deliveryStatus=''}={}) {
 return new TextEncoder().encode([
  'From: Mail Delivery Subsystem <mailer-daemon@example.com>',
  'Subject: Delivery Status Notification (Failure)', 'Auto-Submitted: auto-replied',
  'Message-ID: <bounce@example.com>', 'In-Reply-To: <sent-id-1@example.com>', 'References: <sent-id-1@example.com>',
  ...(failedHeader?[`X-Failed-Recipients: ${recipient}`]:[]),
  'MIME-Version: 1.0', 'Content-Type: multipart/report; boundary="B0"; report-type=delivery-status', '',
  '--B0', 'Content-Type: multipart/related; boundary="B1"', '',
  '--B1', 'Content-Type: multipart/alternative; boundary="B2"', '',
  '--B2', 'Content-Type: text/plain; charset=utf-8', '', '** Address not found **', '',
  ...(sentence?[`Your message wasn't delivered to ${recipient} because the address couldn't be found, or is unable to receive mail.`]:[]),
  '', 'The response was:', `550 ${status} The email account that you tried to reach is inactive.`,
  '--B2', 'Content-Type: text/html; charset=utf-8', '', '<p>Address not found</p>', '--B2--',
  '--B1', 'Content-Type: image/png', 'Content-ID: <icon.png>', 'Content-Transfer-Encoding: base64', '', 'aWNvbg==', '--B1--',
  '--B0', 'Content-Type: message/delivery-status', '',
  structured?`Final-Recipient: rfc822; ${recipient}\r\nAction: failed\r\nStatus: ${status}`:deliveryStatus,
  ...(returned?['--B0', 'Content-Type: text/rfc822-headers', '', `To: <${recipient}>`,
   'Message-ID: <sent-id-1@example.com>', 'Subject: Fixture', 'From: Fixture sender <sender@example.com>']:[]),
  '--B0--', '',
 ].join('\r\n'));
}
