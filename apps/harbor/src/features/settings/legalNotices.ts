const MIT = (copyright: string) => `${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

const ISC = (copyright: string) => `${copyright}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

export interface LegalNotice {
  name: string;
  url: string;
  attribution: string;
  license: string;
  licenseUrl: string;
  /** Full text where the license requires the notice itself be reproduced. */
  licenseText?: string;
}

// Bundled third-party assets whose licenses require attribution. OFL fonts
// carry their notice in the file and are not listed.
export const LEGAL_NOTICES: readonly LegalNotice[] = [
  {
    name: 'Twemoji',
    url: 'https://github.com/jdecked/twemoji',
    attribution:
      'Emoji graphics copyright Twitter, Inc and other contributors.',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    name: 'Ionicons',
    url: 'https://ionic.io/ionicons',
    attribution: 'Copyright (c) 2015-present Ionic (http://ionic.io/)',
    license: 'MIT License',
    licenseUrl: 'https://github.com/ionic-team/ionicons/blob/main/LICENSE',
    licenseText: MIT('Copyright (c) 2015-present Ionic (http://ionic.io/)'),
  },
  {
    name: 'Material Icons',
    url: 'https://fonts.google.com/icons',
    attribution: 'Copyright Google LLC',
    license: 'Apache License 2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  {
    name: 'Material Design Icons',
    url: 'https://pictogrammers.com/library/mdi/',
    attribution: 'Copyright Pictogrammers',
    license: 'Apache License 2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  {
    name: 'emojis.json',
    url: 'https://github.com/chalda-pnuzig/emojis.json',
    attribution: 'Copyright (c) Chalda Pnuzig 2021-2024',
    license: 'ISC License',
    licenseUrl:
      'https://github.com/chalda-pnuzig/emojis.json/blob/master/LICENSE',
    licenseText: ISC('Copyright (c) Chalda Pnuzig 2021-2024'),
  },
];
