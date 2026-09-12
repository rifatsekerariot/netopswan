#!/bin/bash
# ==============================================================================
# NetOpsWan Standalone Linux x86_64 Kurumsal Dağıtım Paketi Oluşturucu
# ==============================================================================

set -e

BUILD_DIR="./build_dist"
OUTPUT_DIR="./dist"
PACKAGE_NAME="netopswan-v1.0-x86_64"

echo "=== [1/4] Derleme Dizinleri Temizleniyor ve Hazırlanıyor ==="
rm -rf "$BUILD_DIR" "$OUTPUT_DIR"
mkdir -p "$BUILD_DIR/$PACKAGE_NAME/frontend"
mkdir -p "$BUILD_DIR/$PACKAGE_NAME/backend/openwisp_config"
mkdir -p "$BUILD_DIR/$PACKAGE_NAME/services"
mkdir -p "$OUTPUT_DIR"

echo "=== [2/4] Next.js Standalone Üretim Çıktısı Alınıyor ==="
cd frontend
npm run build

# Standalone derlenmiş sunucuyu ve statik varlıkları kopyala
cp -a .next/standalone/. "../$BUILD_DIR/$PACKAGE_NAME/frontend/"
mkdir -p "../$BUILD_DIR/$PACKAGE_NAME/frontend/.next/static"
cp -a .next/static/. "../$BUILD_DIR/$PACKAGE_NAME/frontend/.next/static/"
cp -a public "../$BUILD_DIR/$PACKAGE_NAME/frontend/"
cd ..

echo "=== [3/4] OpenWISP Backend ve Servis Şablonları Paketleniyor ==="
# Backend dosyalarını hazırla
cat << 'EOF' > "$BUILD_DIR/$PACKAGE_NAME/backend/manage.py"
#!/usr/bin/env python
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "openwisp_config.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
EOF

cat << 'EOF' > "$BUILD_DIR/$PACKAGE_NAME/backend/openwisp_config/settings.py"
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = 'netopswan-production-super-secret-key-x86-appliance'
DEBUG = False
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'openwisp_users',
    'openwisp_utils.admin_theme',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.sites',
    'django.contrib.gis',
    'reversion',
    'allauth',
    'allauth.account',
    'allauth.socialaccount',
    'organizations',
    'openwisp_controller.pki',
    'openwisp_controller.config',
    'openwisp_controller.geo',
    'openwisp_controller.connection',
    'openwisp_ipam',
    'openwisp_network_topology',
    'openwisp_notifications',
    'rest_framework',
    'rest_framework.authtoken',
    'rest_framework_gis',
    'django_filters',
    'taggit',
    'leaflet',
    'django.contrib.admin',
]

AUTH_USER_MODEL = 'openwisp_users.User'
SITE_ID = 1

CELERY_BROKER_URL = 'redis://127.0.0.1:6379/0'
CELERY_RESULT_BACKEND = 'redis://127.0.0.1:6379/0'
CELERY_TASK_ALWAYS_EAGER = True

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'allauth.account.middleware.AccountMiddleware',
]

ROOT_URLCONF = 'openwisp_config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'openwisp_utils.admin_theme.context_processor.menu_items',
            ],
        },
    },
]

WSGI_APPLICATION = 'openwisp_config.wsgi.application'

import os

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'NAME': os.environ.get('DB_NAME', 'openwisp'),
        'USER': os.environ.get('DB_USER', 'openwisp'),
        'PASSWORD': os.environ.get('DB_PASS', 'CHANGE_ME_STRONG_PASSWORD'),
        'HOST': os.environ.get('DB_HOST', '127.0.0.1'),
        'PORT': os.environ.get('DB_PORT', '5432'),
    }
}

AUTH_PASSWORD_VALIDATORS = []
LANGUAGE_CODE = 'tr'
TIME_ZONE = 'Europe/Istanbul'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'static')
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

OPENWISP_ORGANIZATION_USER_ADMIN = True
OPENWISP_ORGANIZATION_OWNER_ADMIN = True
OPENWISP_USERS_AUTH_API = True
OPENWISP_USERS_AUTH_BACKENDS = ['openwisp_users.backends.UsersAuthBackend']
OPENWISP_CONTROLLER_HARDWARE_ID_OPTIONS = {'unique': False}
OPENWISP_CONTROLLER_AUTO_REGISTRATION = False
EOF

cat << 'EOF' > "$BUILD_DIR/$PACKAGE_NAME/backend/openwisp_config/urls.py"
from django.contrib import admin
from django.urls import path, include
from openwisp_ipam.api import views as ipam_views
from openwisp_ipam.api.urls import get_api_urls as get_ipam_urls

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include('openwisp_utils.api.urls')),
    path('api/v1/', include('openwisp_users.api.urls')),
    path('api/v1/', include('openwisp_network_topology.api.urls')),
    path('api/v1/ipam/', include((get_ipam_urls(ipam_views), 'openwisp_ipam'))),
    path('api/v1/controller/', include('openwisp_controller.pki.api.urls')),
    path('api/v1/controller/', include('openwisp_controller.config.api.urls')),
    path('api/v1/', include('openwisp_controller.pki.api.urls')),
    path('api/v1/', include('openwisp_controller.config.api.urls')),
    path('', include('openwisp_controller.urls')),
]
EOF

cat << 'EOF' > "$BUILD_DIR/$PACKAGE_NAME/backend/openwisp_config/wsgi.py"
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'openwisp_config.settings')
application = get_wsgi_application()
EOF

# install.sh ve uninstall.sh ekle
cp installer/install.sh "$BUILD_DIR/$PACKAGE_NAME/install.sh"
chmod +x "$BUILD_DIR/$PACKAGE_NAME/install.sh"

echo "=== [4/4] Tek Bağımsız .tar.gz Dağıtım Paketi Paketleniyor ==="
cd "$BUILD_DIR"
export COPYFILE_DISABLE=1
tar --no-xattrs --no-mac-metadata -czf "../$OUTPUT_DIR/$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME" 2>/dev/null || tar -czf "../$OUTPUT_DIR/$PACKAGE_NAME.tar.gz" "$PACKAGE_NAME"
cd ..

rm -rf "$BUILD_DIR"

echo "===================================================================="
echo "  🎉 TEK BAĞIMSIZ DAĞITIM PAKETİ OLUŞTURULDU: $OUTPUT_DIR/$PACKAGE_NAME.tar.gz"
echo "===================================================================="
