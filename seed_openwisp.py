import os
import uuid
import random
from django.contrib.auth import get_user_model
from openwisp_users.models import Organization
from openwisp_controller.config.models import Device, DeviceGroup

User = get_user_model()
org = Organization.objects.first()
if not org:
    org = Organization.objects.create(name="ARIOT SD-WAN", slug="ariot-sdwan")

print(f"Organization: {org.name}")

# Create Device Groups
groups_data = [
    ("Bölge-Merkez", "Marmara ve Genel Merkez Şubeleri"),
    ("Bölge-Anadolu", "İç Anadolu ve Doğu Şubeleri"),
    ("Bölge-Ege", "Ege ve Akdeniz Şubeleri"),
    ("Model-MX64-Prod", "Cisco Meraki MX64 Ana Filo")
]

created_groups = []
for name, desc in groups_data:
    grp, _ = DeviceGroup.objects.get_or_create(
        name=name,
        organization=org
    )
    created_groups.append(grp)

print(f"Created {len(created_groups)} Device Groups.")

# Create Devices (500 Nodes)
cities = ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Konya", "Gaziantep", "Kocaeli", "Mersin"]
firmwares = ["OpenWrt 23.05.2 r23630", "OpenWrt 23.05.0 r23497"]

existing_count = Device.objects.count()
print(f"Current devices in DB: {existing_count}")

devices_to_create = []
for i in range(existing_count, 500):
    num = str(i + 1).zfill(3)
    city = cities[i % len(cities)]
    grp = created_groups[i % len(created_groups)]
    mac = f"00:18:0A:{random.randint(10,89):02X}:{random.randint(10,89):02X}:{random.randint(10,89):02X}"
    
    dev = Device(
        name=f"Sube-{num}-{city}",
        mac_address=mac,
        key=uuid.uuid4().hex,
        organization=org,
        model="Cisco Meraki MX64",
        notes=f"Broadcom BCM58625 (2 Cores ARMv7) - 2GB RAM - {firmwares[i % len(firmwares)]}"
    )
    devices_to_create.append(dev)

if devices_to_create:
    Device.objects.bulk_create(devices_to_create)
    print(f"Successfully seeded {len(devices_to_create)} Meraki MX64 nodes into real OpenWISP database!")
else:
    print(f"Database already contains {existing_count} devices.")
