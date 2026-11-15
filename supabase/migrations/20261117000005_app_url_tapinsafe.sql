-- The scheduled jobs call the site at its own domain now (www.tapinsafe.app, was tapin-alpha-six.vercel.app).
select vault.update_secret(s.id, 'https://www.tapinsafe.app')
from vault.secrets s where s.name = 'tapin_app_url';
