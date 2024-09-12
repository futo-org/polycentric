# gitlab provider

# grafana provider


# depends_on = k8s.module


resource "gitlab_application" "oidc" {
  confidential = true
  scopes       = ["openid","openid profile","email", "offline_access"]
  name         = "polycentric_grafana" # use var / local
  redirect_url = ""                   # potentially tailscale namespace, do not want to expose another LB for this
}

# # Configure SSO using generic OAuth2
resource "grafana_sso_settings" "gitlab_sso_settings" {
  provider_name = "gitlab"
  oauth2_settings {
    name              = "FUTO GitLab"
    auth_url          = "https://gitlab.futo.org/oauth/authorize" # gitlab.futo.org from var / local
    token_url         = "https://gitlab.futo.org/oauth/token"
    api_url           = "https://gitlab.futo.org/oauth/userinfo"
    client_id         = gitlab_application.oidc.application_id
    client_secret     = gitlab_application.oidc.secret
    allow_sign_up     = true
    auto_login        = false
    scopes            = "openid profile email offline_access"
    use_pkce          = true
    use_refresh_token = true
  }
}
