import { apiClient } from '@/lib/api-client';
import type { User, UserFilters, UsersResponse, UserMutationPayload } from './types';

// NOT: /api/users veritabanı satırlarını { id, username, email, role, created_at, status }
// şeklinde döndürür (gerçek id VARCHAR, örn. 'user-172...'). Ancak bu feature'ın paylaşılan
// User tipi (mock-api-users.ts) id: number bekliyor ve first_name/last_name/phone alanları
// var - bu yüzden burada gerçek API yanıtı var olan sözleşmeye adapte ediliyor. Update/delete
// için benzersiz olan `email` alanı köprü olarak kullanılıyor (bkz. api/users/[id]/route.ts).
function toUser(row: any, index: number): User {
  return {
    id: index + 1,
    first_name: row.username,
    last_name: '',
    email: row.email,
    phone: '',
    status: row.status || 'Active',
    role: row.role,
    created_at: row.created_at,
    updated_at: row.created_at
  };
}

export async function getUsers(filters: UserFilters): Promise<UsersResponse> {
  const params = new URLSearchParams({
    page: String(filters.page || 1),
    limit: String(filters.limit || 10),
    search: filters.search || ''
  });

  const response = await apiClient<any>(`/users?${params}`);
  const rows = response.data?.users || [];
  const offset = ((filters.page || 1) - 1) * (filters.limit || 10);

  return {
    success: response.success !== false,
    time: response.time || new Date().toISOString(),
    message: response.message || '',
    total_users: response.data?.total || rows.length,
    offset,
    limit: filters.limit || 10,
    users: rows.map(toUser)
  };
}

export async function createUser(data: UserMutationPayload) {
  const response = await apiClient<any>('/users', {
    method: 'POST',
    body: JSON.stringify({
      username: data.first_name,
      email: data.email,
      role: data.role
    })
  });

  return response.data;
}

export async function updateUser(id: number, currentEmail: string, data: UserMutationPayload) {
  // Numeric id yalnızca liste sırasını temsil eder, DB satırıyla eşleşmez - bu yüzden
  // DB satırı orijinal (değişmeden önceki) email üzerinden bulunuyor.
  const response = await apiClient<any>(`/users/${encodeURIComponent(currentEmail)}`, {
    method: 'PUT',
    body: JSON.stringify({
      first_name: data.first_name,
      email: data.email,
      role: data.role
    })
  });

  return response;
}

export async function deleteUser(id: number, email?: string) {
  if (!email) {
    throw new Error('deleteUser: email zorunludur (numeric id DB satırıyla eşleşmez)');
  }
  return apiClient<any>(`/users/${encodeURIComponent(email)}`, {
    method: 'DELETE'
  });
}
