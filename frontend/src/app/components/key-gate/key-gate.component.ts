import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { GlowmetricsService } from '../../services/glowmetrics.service';

/**
 * Pantalla de la clave de acceso: tapa toda la app hasta que se teclea la clave. Solo sale en un
 * dispositivo nuevo (o si se cambió la clave); una vez aceptada se recuerda y no vuelve a salir.
 */
@Component({
  selector: 'app-key-gate',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './key-gate.component.html',
  styleUrls: ['./key-gate.component.scss'],
})
export class KeyGateComponent {
  key = '';
  checking = false;
  error: string | null = null;

  constructor(private auth: AuthService, private svc: GlowmetricsService) {}

  submit(): void {
    const key = this.key.trim();
    if (!key || this.checking) return;
    this.checking = true;
    this.error = null;
    this.svc.checkKey(key).subscribe(res => {
      this.checking = false;
      if (res?.ok) {
        this.auth.unlock(key);
        // Se recarga para que todas las pantallas pidan sus datos ya con la clave.
        location.reload();
        return;
      }
      this.error = res?.error === 'unauthorized'
        ? 'Esa clave no es correcta.'
        : 'No se pudo comprobar la clave. Revisa la conexión e inténtalo de nuevo.';
      this.key = '';
    });
  }
}
