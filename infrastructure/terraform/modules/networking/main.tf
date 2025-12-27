# VPC Network
resource "google_compute_network" "main" {
  project                 = var.project_id
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
}

# Subnet for Cloud Run VPC connector
resource "google_compute_subnetwork" "main" {
  project                  = var.project_id
  name                     = "${var.name_prefix}-subnet"
  ip_cidr_range            = "10.8.0.0/28"
  region                   = var.region
  network                  = google_compute_network.main.id
  private_ip_google_access = true
}

# VPC Access Connector for Cloud Run to access private resources
resource "google_vpc_access_connector" "main" {
  project = var.project_id
  name    = "${var.name_prefix}-connector"
  region  = var.region

  subnet {
    name = google_compute_subnetwork.main.name
  }

  min_instances = 2
  max_instances = 3
}

# Global address for private services access (Cloud SQL)
resource "google_compute_global_address" "private_ip_range" {
  project       = var.project_id
  name          = "${var.name_prefix}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

# Private services connection for Cloud SQL
resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

# Firewall rule to allow internal communication
resource "google_compute_firewall" "allow_internal" {
  project = var.project_id
  name    = "${var.name_prefix}-allow-internal"
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }

  allow {
    protocol = "icmp"
  }

  source_ranges = ["10.8.0.0/16"]
}
