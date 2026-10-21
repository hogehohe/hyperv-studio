#!/usr/bin/env bash
set -euo pipefail

# Run inside the origin VM: sudo bash prepare-linux-template.sh --shutdown
# This prepares AlmaLinux / Rocky Linux / RHEL 9 or 10 for Hyper-V Studio.
# The guest shuts down at the end. Keep it powered off while making copies.

if [[ ${EUID} -ne 0 || ${1:-} != --shutdown ]]; then
  echo 'Usage: sudo bash prepare-linux-template.sh --shutdown' >&2
  echo 'This changes template settings and shuts down this guest.' >&2
  exit 1
fi

source /etc/os-release
case ${ID:-} in
  almalinux|rocky|rhel) ;;
  *) echo 'Supported guests: AlmaLinux / Rocky Linux / RHEL 9 or 10.' >&2; exit 1 ;;
esac
case ${VERSION_ID%%.*} in
  9|10) ;;
  *) echo 'Supported versions: 9 or 10.' >&2; exit 1 ;;
esac

for tool in dnf nmcli systemctl; do
  command -v "$tool" >/dev/null || { echo "Missing command: $tool" >&2; exit 1; }
done
if grep -Fq 'cloud-init=disabled' /proc/cmdline || grep -Fq 'network-config=disabled' /proc/cmdline; then
  echo 'Remove the cloud-init/network disable option from the guest boot configuration first.' >&2
  exit 1
fi

dnf install -y cloud-init
clean_help=$(cloud-init clean --help)
for flag in --machine-id --seed; do
  grep -q -- "$flag" <<< "$clean_help" || {
    echo "A cloud-init version supporting clean $flag is required." >&2
    exit 1
  }
done

network_unit=''
for unit in cloud-init-network.service cloud-init.service; do
  if systemctl cat "$unit" >/dev/null 2>&1; then network_unit=$unit; break; fi
done
[[ -n $network_unit ]] || { echo 'The cloud-init network service is missing.' >&2; exit 1; }

backup_dir=/var/lib/hyperv-studio-template
install -d -m 700 "$backup_dir" /etc/cloud/cloud.cfg.d
config_file=/etc/cloud/cloud.cfg.d/99-hyperv-studio.cfg
if [[ -f $config_file && ! -f $backup_dir/original-cloud-config ]]; then
  cp -p "$config_file" "$backup_dir/original-cloud-config"
fi
if [[ -f /etc/cloud/cloud-init.disabled ]]; then
  mv /etc/cloud/cloud-init.disabled "$backup_dir/cloud-init.disabled"
fi
nmcli -t -f UUID,TYPE,AUTOCONNECT connection show > "$backup_dir/network-profiles-before.txt"

cat > "$config_file" <<'CLOUD_CONFIG'
# Hyper-V Studio: configure identity and DHCP from the clone's CIDATA disc.
datasource_list: [NoCloud]
manual_cache_clean: false
preserve_hostname: false
manage_etc_hosts: localhost
users: []
disable_root: false
network: null
cloud_init_modules:
  - seed_random
  - set_hostname
  - update_hostname
  - update_etc_hosts
  - ssh
cloud_config_modules: []
cloud_final_modules: []
CLOUD_CONFIG
chmod 644 "$config_file"

# Older cloud-init NetworkManager renderers omit subnet route metrics. Apply
# defaults only to the exact eth0..eth7 interfaces used by our clone seed.
# No profiles are activated or reloaded here; these defaults take effect on
# the clone's next boot. Lower numbered NICs have preferred default routes.
install -d -m 755 /etc/NetworkManager/conf.d
route_config=/etc/NetworkManager/conf.d/99-hyperv-studio-routes.conf
if [[ -f $route_config && ! -f $backup_dir/original-route-config ]]; then
  cp -p "$route_config" "$backup_dir/original-route-config"
fi
{
  echo '# Hyper-V Studio: distinct DHCP route metrics for cloned interfaces.'
  for ((interface_index=0; interface_index<8; interface_index++)); do
    route_metric=$(((interface_index + 1) * 100))
    printf '\n[connection-hyperv-studio-eth%d]\n' "$interface_index"
    printf 'match-device=interface-name:eth%d\n' "$interface_index"
    printf 'ipv4.route-metric=%d\n' "$route_metric"
  done
} > "$route_config"
chmod 644 "$route_config"

# Keep current connections up until poweroff, but stop their copied static
# profiles from competing with the new MAC-matched DHCP profile at next boot.
while IFS=: read -r connection_uuid connection_type; do
  case $connection_type in
    802-3-ethernet|ethernet)
      nmcli connection modify uuid "$connection_uuid" connection.autoconnect no
      ;;
  esac
done < <(nmcli -t -f UUID,TYPE connection show)

systemctl enable cloud-init-local.service "$network_unit" cloud-config.service cloud-final.service
# A regular D-Bus machine-id file would otherwise seed the old machine identity.
if [[ -f /var/lib/dbus/machine-id && ! -L /var/lib/dbus/machine-id ]]; then
  cp -p /var/lib/dbus/machine-id "$backup_dir/dbus-machine-id"
  rm -- /var/lib/dbus/machine-id
  ln -s /etc/machine-id /var/lib/dbus/machine-id
fi
cloud-init clean --logs --machine-id --seed
sync
echo 'Template ready. Shutting down. Copy it without booting the origin again.'
echo 'After updating the origin, run this preparation again before copying.'
systemctl poweroff
