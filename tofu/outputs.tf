output "bastion_public_ipv4" {
  value = hcloud_server.bastion.ipv4_address
}

output "egress_public_ipv4" {
  value = hcloud_server.egress.ipv4_address
}

output "helper_backend_public_ipv4" {
  value = var.helper_backend_enabled ? hcloud_server.helper_backend[0].ipv4_address : ""
}

output "load_balancer_public_ipv4" {
  value = hcloud_load_balancer.main.ipv4
}

output "k3s_api_load_balancer_private_ipv4" {
  value = local.k3s_ha_enabled ? local.k3s_api_lb_private_ip : ""
}

output "private_ips" {
  value = {
    bastion        = var.servers.bastion.private_ip
    egress         = var.servers.egress.private_ip
    helper_backend = var.helper_backend_enabled ? var.servers.helper_backend.private_ip : ""
    k3s_nodes      = [for node in var.k3s_nodes : node.private_ip]
    db             = var.servers.db.private_ip
  }
}

output "db_volume_id" {
  value = hcloud_volume.db.id
}
