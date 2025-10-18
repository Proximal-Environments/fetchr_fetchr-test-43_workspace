'use strict'

exports.config = {
  app_name: ["Fetchr Backend"],
  license_key: "a4aa26c42024b550d73a3403a22f4cd8FFFFNRAL",
  logging: {
    level: 'info',
    enabled: true
  },
  allow_all_headers: true,
  attributes: {
    exclude: [
      'request.headers.cookie',
      'request.headers.authorization',
      'request.headers.proxyAuthorization',
      'request.headers.setCookie*',
      'request.headers.x*',
      'response.headers.cookie',
      'response.headers.authorization',
      'response.headers.proxyAuthorization',
      'response.headers.setCookie*',
      'response.headers.x*'
    ]
  }
}
