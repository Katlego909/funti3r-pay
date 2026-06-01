# Funti3r-pay Infrastructure - AWS
# Phase 1 placeholder - Full implementation needed

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# RDS PostgreSQL
resource "aws_db_instance" "postgres" {
  identifier     = "funti3r-postgres-${var.environment}"
  engine         = "postgres"
  engine_version = "16.1"
  instance_class = "db.t3.micro"

  allocated_storage = 20
  storage_encrypted = true

  db_name  = "funti3r_${var.environment}"
  username = var.db_username
  password = var.db_password

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = "funti3r-postgres-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  tags = {
    Name        = "funti3r-postgres-${var.environment}"
    Environment = var.environment
  }
}

# ElastiCache Redis
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "funti3r-redis-${var.environment}"
  engine               = "redis"
  node_type           = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379

  tags = {
    Name        = "funti3r-redis-${var.environment}"
    Environment = var.environment
  }
}

# DocumentDB for MongoDB compatibility
resource "aws_docdb_cluster" "mongodb" {
  cluster_identifier      = "funti3r-mongodb-${var.environment}"
  engine                  = "docdb"
  master_username         = var.db_username
  master_password         = var.db_password
  backup_retention_period = 5
  preferred_backup_window = "03:00-04:00"

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = "funti3r-mongodb-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  tags = {
    Name        = "funti3r-mongodb-${var.environment}"
    Environment = var.environment
  }
}
