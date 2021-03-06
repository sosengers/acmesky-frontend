import {Component, Injectable, OnInit} from '@angular/core';
import {AbstractControl, FormBuilder, FormControl, FormGroup, Validators} from '@angular/forms';
import {Socket} from 'ngx-socket-io';
import {OffersService} from 'src/api/offers.service';
import {Address} from 'src/model/address';
import {OfferPurchaseData} from 'src/model/offer-purchase-data';
import {Step, StepperProgressBarController} from 'stepper-progress-bar';
import {CountryPickerService, ICountry} from 'ngx-country-picker';
import {NgSelectConfig} from '@ng-select/ng-select';

export enum TransactionStatus {
    NothingDone,
    WaitingOfferCodeValidity,
    WaitingPayment,
    TicketsArrived,
    SomethingWentWrong
}

@Component({
    // tslint:disable-next-line:component-selector
    selector: 'buy-offer-form',
    templateUrl: './buy-offer-form.component.html',
    styleUrls: ['./buy-offer-form.component.css'],
})
@Injectable()
// tslint:disable-next-line:component-class-suffix
export class BuyOfferForm implements OnInit {

    countries: ICountry[] = [];
    selectedCountry?: string;

    formData!: FormGroup;

    firstRequestPerformed = false;
    successfullyPushedOfferData!: boolean;
    joinedQueue!: boolean;
    communicationCode = '';
    webSocketMessage = '';
    webSocketError = false;

    steps: Step[] = new Array<Step>(new Step('Validazione codice offerta'), new Step('Pagamento effettuato'), new Step('Ricezione bliglietti'));
    progressStepper: StepperProgressBarController = new StepperProgressBarController();

    paymentUrl = '';

    TransactionStatus = TransactionStatus;
    status: TransactionStatus = TransactionStatus.NothingDone;

    // tslint:disable-next-line:ban-types
    tickets: any = null;

    constructor(
        private offersService: OffersService,
        private formBuilder: FormBuilder,
        private socket: Socket,
        protected countryPicker: CountryPickerService,
        private pickerConfig: NgSelectConfig
    ) {
        this.pickerConfig.notFoundText = '';
        this.pickerConfig.appendTo = 'body';
        this.pickerConfig.bindValue = 'value';
    }

    ngOnInit(): void {
        this.formData = this.formBuilder.group({
            city: new FormControl(null, [Validators.required]),
            number: new FormControl(null, [Validators.required]),
            country: new FormControl(null, []),
            street: new FormControl(null, [Validators.required]),
            zip_code: new FormControl(null, [Validators.required, Validators.pattern('^[0-9]+$')]),
            name: new FormControl(null, [Validators.required]),
            surname: new FormControl(null, [Validators.required]),
            offer_code: new FormControl(null, [Validators.required, Validators.minLength(10), Validators.maxLength(10)]),
        });

        // Retrieve the countries list, order it in alphabetic order and save it
        this.countryPicker.getCountries().subscribe((countries) => {
            this.countries = countries.sort((c1, c2) => {
                if (c1.translations.ita.common > c2.translations.ita.common) {
                    return 1;
                } else {
                    if (c1.translations.ita.common < c2.translations.ita.common) {
                        return -1;
                    }
                }
                return 0;
            });
        });

    }


    operationResult(): string {
        /*
        Method called when a new message from the WebSocket arrives.
        It could be an error, the tickets, the URL for the Payment Provider or some message from ACMESky to show to the user.
         */
        if (this.successfullyPushedOfferData) {
            if (!this.joinedQueue) {
                this.socket.emit('join', this.communicationCode);
                // tslint:disable-next-line:variable-name
                this.socket.on('json', (purchase_process_information: string) => {
                    const ppi = JSON.parse(purchase_process_information);
                    if (ppi.communication_code !== this.communicationCode) {
                        return;
                    }
                    this.webSocketError = ppi.is_error;

                    if (this.webSocketError) {
                        this.status = TransactionStatus.SomethingWentWrong;
                        this.webSocketMessage = ppi.message;
                        return;
                    }

                    if (ppi.flights !== undefined) {
                        // ppi contains the tickets
                        this.status = TransactionStatus.TicketsArrived;
                        this.progressStepper.nextStep();
                        this.tickets = ppi;
                        this.webSocketMessage = 'I biglietti sono stati acquistati correttamente. Ecco un riepilogo del viaggio.';
                        this.progressStepper.nextStep();
                    } else {
                        if (!ppi.message.startsWith('http://')) {
                            // ppi contains a message
                            this.progressStepper.nextStep();
                            this.webSocketMessage = ppi.message;
                        } else {
                            // ppi contains a URL
                            this.progressStepper.nextStep();
                            this.webSocketMessage = 'Codice offerta valido, cliccare il pulsante per procedere con il pagamento.';
                            this.status = TransactionStatus.WaitingPayment;
                            console.log(`Payment URL: ${ppi.message}`);
                            this.paymentUrl = ppi.message;
                        }
                    }
                });

                this.joinedQueue = true;
            }
            // vvv First published message vvv
            return 'Il codice offerta è stato inserimento correttamente.';
        }
        return 'L\'operazione non è andata a buon fine. Riprova.';
    }


    submitOfferData(): void {
        // Get the data to send to ACMESky Backend
        const offerPurchaseData = {
            address: {
                city: this.formData.value.city,
                country: this.selectedCountry,
                number: this.formData.value.number,
                street: this.formData.value.street,
                zip_code: this.formData.value.zip_code
            } as Address,
            name: this.formData.value.name,
            surname: this.formData.value.surname,
            offer_code: this.formData.value.offer_code
        } as OfferPurchaseData;

        this.status = TransactionStatus.WaitingOfferCodeValidity;

        // Use the offersService to contact ACMESky Bakcend sending the data
        this.offersService.buyOffer(offerPurchaseData).subscribe(
            (response) => {
                // tslint:disable-next-line:max-line-length
                this.communicationCode = (response.body?.communication_code !== null && response.body?.communication_code !== undefined) ? response.body.communication_code : '';
                console.log('BODY:' + response.body);
                this.successfullyPushedOfferData = true;
                this.joinedQueue = false;
                console.log('[SUCCESS] The offer purchase data was successfully inserted into ACMESky. The user is given the Payment Provider URL: ' + this.communicationCode + '.');
            },
            (_) => {
                this.successfullyPushedOfferData = false;
                console.log('[ERROR] The offer purchase data was not correct.');
            }
        );
        this.firstRequestPerformed = true;
    }

    dateToLocale(date: string): string {
        // Convert a date to the locale format
        return (new Date(date)).toLocaleString();
    }

    /*
    Checks to perform on the form
     */
    missingRequired(control: AbstractControl): string {
        if (control.hasError('required')) {
            return 'Questo campo deve essere compilato.';
        }

        return '';
    }

    offerCodeError(): string {
        const offer_code = this.formData.controls.offer_code;
        const req = this.missingRequired(offer_code);
        if (req !== '') {
            return req;
        }

        return (offer_code.hasError('minlength') || offer_code.hasError('maxlength')) ? 'Il codice dell\'offerta è composto di 10 caratteri alfanumerici.' : '';
    }

    nameError(): string {
        return this.missingRequired(this.formData.controls.name);
    }

    surnameError(): string {
        return this.missingRequired(this.formData.controls.surname);
    }

    streetError(): string {
        return this.missingRequired(this.formData.controls.street);
    }

    numberError(): string {
        return this.missingRequired(this.formData.controls.number);
    }

    cityError(): string {
        return this.missingRequired(this.formData.controls.city);
    }

    zipCodeError(): string {
        const zip_code = this.formData.controls.zip_code;

        const req = this.missingRequired(zip_code);
        if (req !== '') {
            return req;
        }

        return zip_code.hasError('pattern') ? 'Il CAP deve essere formato di soli caratteri numerici.' : '';
    }
}
