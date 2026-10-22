use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct PhysicalNetworkAdapter {
    pub interface_guid: String,
    pub name: String,
    pub interface_description: String,
    pub mac_address: String,
    pub status: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Ipv4Address {
    pub ip_address: String,
    pub prefix_length: u8,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HostIpv4Settings {
    pub interface_guid: String,
    pub interface_index: u32,
    pub interface_name: String,
    pub dhcp: String,
    pub addresses: Vec<Ipv4Address>,
    pub has_default_gateway: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SwitchHostAdapterSnapshot {
    pub name: String,
    pub interface_guid: String,
    pub interface_index: u32,
    pub mac_address: String,
    pub ip_addresses: Vec<String>,
    pub dhcp: String,
    pub status: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NetworkSwitchChangeInfo {
    pub switch_id: String,
    pub name: String,
    pub switch_type: String,
    pub revision: String,
    pub is_system_managed: bool,
    pub can_delete: bool,
    pub delete_reason: Option<String>,
    pub can_configure_host_ipv4: bool,
    pub host_ipv4_reason: Option<String>,
    pub vm_adapter_count: u32,
    pub host_adapters: Vec<SwitchHostAdapterSnapshot>,
    pub host_ipv4: Option<HostIpv4Settings>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CreateNetworkSwitchRequest {
    pub name: String,
    pub switch_type: String,
    pub physical_adapter_guid: Option<String>,
    pub allow_management_os: bool,
    pub external_impact_confirmed: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteNetworkSwitchRequest {
    pub switch_id: String,
    pub expected_revision: String,
    pub confirmation_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SaveHostNetworkIpv4Request {
    pub switch_id: String,
    pub expected_revision: String,
    pub confirmation_name: String,
    pub ip_address: String,
    pub prefix_length: u8,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DeletedNetworkSwitch {
    pub switch_id: String,
    pub name: String,
}

fn validate_guid(value: &str) -> Result<(), String> {
    if value.len() == 36
        && uuid::Uuid::parse_str(value).is_ok_and(|guid| {
            !guid.is_nil() && guid.hyphenated().to_string().eq_ignore_ascii_case(value)
        })
    {
        Ok(())
    } else {
        Err("ネットワークの識別子が正しくありません。再取得してください。".into())
    }
}

fn validate_name(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.trim() != value
        || value.chars().count() > 256
        || value.chars().any(char::is_control)
    {
        return Err(
            "スイッチ名は前後の空白・制御文字を含まない1〜256文字で指定してください。".into(),
        );
    }
    Ok(())
}

fn validate_confirmation(id: &str, revision: &str, name: &str) -> Result<(), String> {
    validate_guid(id)?;
    validate_name(name)?;
    if revision.len() != 64 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("取得時のネットワーク構成を確認できません。再取得してください。".into());
    }
    Ok(())
}

fn validate_create(request: &CreateNetworkSwitchRequest) -> Result<(), String> {
    validate_name(&request.name)?;
    match request.switch_type.as_str() {
        "External" => {
            validate_guid(request.physical_adapter_guid.as_deref().unwrap_or(""))?;
            if !request.external_impact_confirmed {
                return Err("外部スイッチ作成時の通信への影響を確認してください。".into());
            }
        }
        "Internal" | "Private" => {
            if request.physical_adapter_guid.is_some() {
                return Err("内部・プライベートスイッチには物理NICを指定できません。".into());
            }
        }
        _ => return Err("仮想スイッチの種類が正しくありません。".into()),
    }
    Ok(())
}

fn validate_ipv4(request: &SaveHostNetworkIpv4Request) -> Result<(), String> {
    validate_confirmation(
        &request.switch_id,
        &request.expected_revision,
        &request.confirmation_name,
    )?;
    let address = request
        .ip_address
        .parse::<std::net::Ipv4Addr>()
        .map_err(|_| "IPv4アドレスをドット区切りの10進数で指定してください。".to_string())?;
    if address.to_string() != request.ip_address || !(1..=30).contains(&request.prefix_length) {
        return Err("IPv4アドレスと1〜30のプレフィックス長を指定してください。".into());
    }
    let first = address.octets()[0];
    if first == 0 || first == 127 || first >= 224 {
        return Err("ホストのIPv4にはユニキャストアドレスを指定してください。".into());
    }
    let host_bits = 32 - request.prefix_length;
    let host_mask = (1u32 << host_bits) - 1;
    let host = u32::from(address) & host_mask;
    if host == 0 || host == host_mask {
        return Err("ネットワークアドレスとブロードキャストアドレスは指定できません。".into());
    }
    Ok(())
}

pub fn change_info(switch_id: &str) -> Result<NetworkSwitchChangeInfo, String> {
    validate_guid(switch_id)?;
    crate::hyperv::run_action(
        "get_network_switch_change_info",
        serde_json::json!({ "switch_id": switch_id }),
    )
}

pub fn create(request: CreateNetworkSwitchRequest) -> Result<NetworkSwitchChangeInfo, String> {
    validate_create(&request)?;
    crate::hyperv::run_action(
        "create_network_switch",
        serde_json::to_value(request).map_err(|error| error.to_string())?,
    )
}

pub fn delete(request: DeleteNetworkSwitchRequest) -> Result<DeletedNetworkSwitch, String> {
    validate_confirmation(
        &request.switch_id,
        &request.expected_revision,
        &request.confirmation_name,
    )?;
    crate::hyperv::run_action(
        "delete_network_switch",
        serde_json::to_value(request).map_err(|error| error.to_string())?,
    )
}

pub fn save_ipv4(request: SaveHostNetworkIpv4Request) -> Result<NetworkSwitchChangeInfo, String> {
    validate_ipv4(&request)?;
    crate::hyperv::run_action(
        "save_host_network_ipv4",
        serde_json::to_value(request).map_err(|error| error.to_string())?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn only_non_nil_hyphenated_guids_are_accepted() {
        assert!(validate_guid(ID).is_ok());
        for id in [
            "vm-name",
            "00000000-0000-0000-0000-000000000000",
            "{11111111-1111-4111-8111-111111111111}",
        ] {
            assert!(validate_guid(id).is_err());
        }
    }

    #[test]
    fn external_creation_requires_physical_guid_and_impact_confirmation() {
        let mut request = CreateNetworkSwitchRequest {
            name: "Lab".into(),
            switch_type: "External".into(),
            physical_adapter_guid: None,
            allow_management_os: true,
            external_impact_confirmed: false,
        };
        assert!(validate_create(&request).is_err());
        request.physical_adapter_guid = Some(ID.into());
        assert!(validate_create(&request).is_err());
        request.external_impact_confirmed = true;
        assert!(validate_create(&request).is_ok());
        request.switch_type = "Internal".into();
        assert!(validate_create(&request).is_err());
        request.physical_adapter_guid = None;
        assert!(validate_create(&request).is_ok());
        request.switch_type = "Arbitrary".into();
        assert!(validate_create(&request).is_err());
    }

    #[test]
    fn switch_names_accept_literal_data_but_reject_controls_or_edge_whitespace() {
        assert!(validate_name("検証 [private] '$name'").is_ok());
        for name in ["", " Lab", "Lab ", "Lab\nname", "Lab\0"] {
            assert!(validate_name(name).is_err());
        }
        assert!(validate_name(&"a".repeat(257)).is_err());
    }

    #[test]
    fn changes_require_snapshot_revision_before_any_native_call() {
        assert!(validate_confirmation(ID, &"a".repeat(64), "Lab").is_ok());
        assert!(validate_confirmation(ID, "", "Lab").is_err());
        assert!(validate_confirmation(ID, &"z".repeat(64), "Lab").is_err());
        assert!(validate_confirmation(ID, &"a".repeat(64), "").is_err());
    }

    #[test]
    fn static_ipv4_rejects_noncanonical_unusable_and_network_broadcast_addresses() {
        let mut request = SaveHostNetworkIpv4Request {
            switch_id: ID.into(),
            expected_revision: "a".repeat(64),
            confirmation_name: "Lab".into(),
            ip_address: "192.168.50.1".into(),
            prefix_length: 24,
        };
        assert!(validate_ipv4(&request).is_ok());
        for address in [
            "192.168.50.0",
            "192.168.50.255",
            "127.0.0.1",
            "0.1.2.3",
            "224.0.0.1",
            "255.255.255.255",
            "192.168.050.1",
            "192.168.50.1/24",
            "2001:db8::1",
            " 192.168.50.1",
        ] {
            request.ip_address = address.into();
            assert!(validate_ipv4(&request).is_err(), "{address}");
        }
        request.ip_address = "192.168.50.1".into();
        for prefix in [0, 31, 32, 255] {
            request.prefix_length = prefix;
            assert!(validate_ipv4(&request).is_err());
        }
    }

    #[test]
    fn malformed_requests_cannot_add_arbitrary_native_parameters() {
        assert!(serde_json::from_value::<DeleteNetworkSwitchRequest>(serde_json::json!({ "switch_id": ID, "expected_revision": "a".repeat(64), "confirmation_name": "Lab", "force": true })).is_err());
    }
}
