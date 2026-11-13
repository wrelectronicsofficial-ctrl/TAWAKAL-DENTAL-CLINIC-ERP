<?php
/**
 * Plugin Name: Tawakal Dental ERP - Private Encrypted Backup Vault
 * Description: Provides a restricted HTTPS-only REST API endpoint for storing AES-256-GCM encrypted clinic backup archives in a non-public private directory with HMAC signature validation, duplicate detection, and audit logging.
 * Version: 1.0.0
 * Author: Tawakal Dental Clinic ERP
 * Requires at least: 6.0
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) {
    exit;
}

class Tawakal_Private_Backup_Vault {
    const REST_NAMESPACE = 'tawakal-vault/v1';
    const CAPABILITY = 'tawakal_manage_encrypted_backups';
    const MAX_ARCHIVE_BYTES = 52428800; // 50 MB
    const VAULT_DIR_NAME = 'tawakal-private-vault';

    public function __construct() {
        register_activation_hook(__FILE__, [$this, 'activate']);
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function activate(): void {
        $role = get_role('administrator');
        if ($role) {
            $role->add_cap(self::CAPABILITY);
        }
        $this->ensure_private_vault_dir();
    }

    private function vault_dir(): string {
        // Store outside normal wp-content/uploads public media hierarchy
        return trailingslashit(WP_CONTENT_DIR) . self::VAULT_DIR_NAME;
    }

    private function ensure_private_vault_dir(): string {
        $dir = $this->vault_dir();
        if (!file_exists($dir)) {
            wp_mkdir_p($dir);
        }
        $htaccess = trailingslashit($dir) . '.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "Order deny,allow\nDeny from all\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n");
        }
        $index = trailingslashit($dir) . 'index.php';
        if (!file_exists($index)) {
            file_put_contents($index, "<?php // Silence is golden.\n");
        }
        return $dir;
    }

    public function register_routes(): void {
        register_rest_route(self::REST_NAMESPACE, '/status', [
            'methods'             => 'GET',
            'callback'            => [$this, 'handle_status'],
            'permission_callback' => [$this, 'check_permissions'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/backups', [
            'methods'             => 'GET',
            'callback'            => [$this, 'handle_list_backups'],
            'permission_callback' => [$this, 'check_permissions'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/backups', [
            'methods'             => 'POST',
            'callback'            => [$this, 'handle_upload_backup'],
            'permission_callback' => [$this, 'check_permissions'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/backups/(?P<backup_id>[a-zA-Z0-9_\-]+)', [
            'methods'             => 'GET',
            'callback'            => [$this, 'handle_download_backup'],
            'permission_callback' => [$this, 'check_permissions'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/backups/(?P<backup_id>[a-zA-Z0-9_\-]+)', [
            'methods'             => 'DELETE',
            'callback'            => [$this, 'handle_delete_backup'],
            'permission_callback' => [$this, 'check_permissions'],
        ]);
    }

    public function check_permissions(WP_REST_Request $request) {
        if (!is_ssl() && (!defined('TAWAKAL_ALLOW_LOCAL_HTTP') || !TAWAKAL_ALLOW_LOCAL_HTTP)) {
            return new WP_Error('https_required', 'HTTPS/TLS is strictly required for private clinic backup operations.', ['status' => 403]);
        }

        if (!is_user_logged_in() || !current_user_can(self::CAPABILITY)) {
            $this->append_audit('UNAUTHORIZED_ACCESS', 'Denied access attempt to private backup vault');
            return new WP_Error('forbidden', 'Dedicated integration capability required.', ['status' => 403]);
        }

        // Optional HMAC signature verification when configured in wp-config.php as TAWAKAL_BACKUP_HMAC_SECRET
        if (defined('TAWAKAL_BACKUP_HMAC_SECRET') && TAWAKAL_BACKUP_HMAC_SECRET !== '') {
            $sig = $request->get_header('X-Tawakal-Signature');
            $ts  = $request->get_header('X-Tawakal-Timestamp');
            if (empty($sig) || empty($ts)) {
                return new WP_Error('missing_signature', 'Missing HMAC request signature headers.', ['status' => 401]);
            }
            if (abs(time() - intval($ts)) > 300) {
                return new WP_Error('stale_timestamp', 'Request signature timestamp expired.', ['status' => 401]);
            }
            $expected = hash_hmac('sha256', $ts . '.' . $request->get_body(), TAWAKAL_BACKUP_HMAC_SECRET);
            if (!hash_equals($expected, $sig)) {
                $this->append_audit('INVALID_SIGNATURE', 'Rejected backup request with invalid HMAC signature');
                return new WP_Error('invalid_signature', 'Invalid HMAC request signature.', ['status' => 401]);
            }
        }

        return true;
    }

    public function handle_status(): WP_REST_Response {
        $dir = $this->ensure_private_vault_dir();
        $files = glob(trailingslashit($dir) . '*.tawakal.enc') ?: [];
        return new WP_REST_Response([
            'status'      => 'connected',
            'plugin'      => 'tawakal-private-backup-vault',
            'ssl'         => is_ssl(),
            'archiveCount'=> count($files),
            'publicUrl'   => null, // Intentionally non-public
        ], 200);
    }

    public function handle_list_backups(): WP_REST_Response {
        $meta = get_option('tawakal_vault_metadata', []);
        return new WP_REST_Response(['backups' => array_values($meta)], 200);
    }

    public function handle_upload_backup(WP_REST_Request $request) {
        $body = json_decode($request->get_body(), true);
        if (!is_array($body)) {
            return new WP_Error('invalid_payload', 'Expected JSON encrypted envelope.', ['status' => 400]);
        }

        $backup_id = isset($body['backupId']) ? sanitize_text_field($body['backupId']) : '';
        $checksum  = isset($body['checksum']) ? sanitize_text_field($body['checksum']) : '';
        $encrypted = isset($body['encryptedArchiveBase64']) ? $body['encryptedArchiveBase64'] : '';
        $algorithm = isset($body['algorithm']) ? sanitize_text_field($body['algorithm']) : '';

        if (!preg_match('/^[a-zA-Z0-9_\-]{3,64}$/', $backup_id)) {
            return new WP_Error('invalid_backup_id', 'Invalid backupId format.', ['status' => 400]);
        }
        if ($algorithm !== 'aes-256-gcm' || empty($encrypted) || empty($checksum)) {
            return new WP_Error('encryption_required', 'Only AES-256-GCM encrypted backup envelopes with SHA-256 checksum are accepted.', ['status' => 400]);
        }

        $raw = base64_decode($encrypted, true);
        if ($raw === false || strlen($raw) > self::MAX_ARCHIVE_BYTES) {
            return new WP_Error('invalid_archive_size', 'Archive decoding failed or exceeds size limit.', ['status' => 413]);
        }

        $computed = hash('sha256', $raw);
        if (!hash_equals(strtolower($checksum), strtolower($computed))) {
            return new WP_Error('checksum_mismatch', 'SHA-256 checksum verification failed.', ['status' => 422]);
        }

        $meta = get_option('tawakal_vault_metadata', []);
        if (isset($meta[$backup_id])) {
            return new WP_Error('duplicate_backup', 'Backup ID already exists in private vault.', ['status' => 409]);
        }

        $dir = $this->ensure_private_vault_dir();
        // Generic non-PII filename
        $filename = 'bkp_' . gmdate('Ymd') . '_' . $backup_id . '.tawakal.enc';
        $dest = trailingslashit($dir) . $filename;
        if (file_put_contents($dest, $raw) === false) {
            return new WP_Error('storage_write_failed', 'Failed to persist encrypted archive.', ['status' => 500]);
        }

        $record = [
            'backupId'   => $backup_id,
            'filename'   => $filename,
            'sizeBytes'  => strlen($raw),
            'checksum'   => $computed,
            'algorithm'  => $algorithm,
            'uploadedBy' => wp_get_current_user()->user_login,
            'createdAt'  => gmdate('c'),
        ];
        $meta[$backup_id] = $record;
        update_option('tawakal_vault_metadata', $meta, false);
        $this->append_audit('UPLOAD_ENCRYPTED_BACKUP', "Stored encrypted archive {$backup_id} ({$record['sizeBytes']} bytes)");

        return new WP_REST_Response(['stored' => true, 'metadata' => $record], 201);
    }

    public function handle_download_backup(WP_REST_Request $request) {
        $backup_id = sanitize_text_field($request->get_param('backup_id'));
        $meta = get_option('tawakal_vault_metadata', []);
        if (!isset($meta[$backup_id])) {
            return new WP_Error('not_found', 'Backup archive not found.', ['status' => 404]);
        }
        $file = trailingslashit($this->vault_dir()) . basename($meta[$backup_id]['filename']);
        if (!file_exists($file)) {
            return new WP_Error('missing_file', 'Encrypted archive missing on disk.', ['status' => 404]);
        }
        $bytes = file_get_contents($file);
        $this->append_audit('DOWNLOAD_ENCRYPTED_BACKUP', "Downloaded encrypted archive {$backup_id}");
        return new WP_REST_Response([
            'backupId' => $backup_id,
            'checksum' => $meta[$backup_id]['checksum'],
            'encryptedArchiveBase64' => base64_encode($bytes),
        ], 200);
    }

    public function handle_delete_backup(WP_REST_Request $request) {
        $backup_id = sanitize_text_field($request->get_param('backup_id'));
        $meta = get_option('tawakal_vault_metadata', []);
        if (!isset($meta[$backup_id])) {
            return new WP_Error('not_found', 'Backup archive not found.', ['status' => 404]);
        }
        $file = trailingslashit($this->vault_dir()) . basename($meta[$backup_id]['filename']);
        if (file_exists($file)) {
            @unlink($file);
        }
        unset($meta[$backup_id]);
        update_option('tawakal_vault_metadata', $meta, false);
        $this->append_audit('DELETE_ENCRYPTED_BACKUP', "Removed encrypted archive {$backup_id}");
        return new WP_REST_Response(['deleted' => true, 'backupId' => $backup_id], 200);
    }

    private function append_audit(string $action, string $details): void {
        $logs = get_option('tawakal_vault_audit', []);
        $logs[] = [
            'timestamp' => gmdate('c'),
            'user'      => is_user_logged_in() ? wp_get_current_user()->user_login : 'anonymous',
            'action'    => $action,
            'details'   => $details,
        ];
        if (count($logs) > 250) {
            $logs = array_slice($logs, -250);
        }
        update_option('tawakal_vault_audit', $logs, false);
    }
}

new Tawakal_Private_Backup_Vault();
