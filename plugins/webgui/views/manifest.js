let gcmSenderId = appRequire('services/config').get('plugins.webgui.gcmSenderId');
if(gcmSenderId) { gcmSenderId = gcmSenderId.toString(); }

const manifest = {
  short_name: 'ssmgr',
  name: 'Shadowsocks-Manager',
  icons: [
    {
      src: 'https://static.yeskn.com/greentern/favicon.png',
      type: 'image/png',
      sizes: '48x48'
    },
    {
      src: 'https://static.yeskn.com/greentern/favicon.png',
      type: 'image/png',
      sizes: '128x128'
    },
    {
      src: 'https://static.yeskn.com/greentern/favicon.png',
      type: 'image/png',
      sizes: '144x144'
    },
    {
      src: 'https://static.yeskn.com/greentern/favicon.png',
      type: 'image/png',
      sizes: '256x256'
    }
  ],
  start_url: '/',
  display: 'standalone',
  background_color: '#2196F3',
  theme_color: '#2196F3',
  gcm_sender_id: gcmSenderId,
};

exports.manifest = manifest;
